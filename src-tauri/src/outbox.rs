//! Envois retenus quelques secondes, le temps de pouvoir les annuler (lot W1).
//!
//! La rédaction confie le message au backend (envoi en arrière-plan, lot E1) ;
//! le fil d'envoi attend le délai réglé avant de l'envoyer. Pendant ce temps,
//! la fenêtre principale peut l'annuler (`cancel_send`) : le message est alors
//! rendu à la rédaction, sans rien envoyer. Un envoi est repéré par la clé
//! d'envoi de son brouillon (`Draft::send_key`, propre à chaque rédaction).

use std::collections::hash_map::Entry;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

/// Délai le plus long accepté : un réglage plus long est ramené à cette valeur.
pub(crate) const MAX_DELAY: Duration = Duration::from_secs(30);

/// Intervalle entre deux regards sur l'annulation pendant le délai : assez
/// court pour qu'un clic sur « Annuler » arrête l'attente sans délai visible.
const POLL: Duration = Duration::from_millis(100);

/// Sort d'un envoi retenu, une fois le délai écoulé ou l'annulation demandée.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Outcome {
    /// Le délai est passé sans annulation : le message part.
    Send,
    /// L'utilisateur a annulé : le message est rendu à la rédaction.
    Cancelled,
}

/// Envois en attente de leur délai, par clé d'envoi.
#[derive(Debug, Default)]
pub struct HeldSends {
    held: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl HeldSends {
    /// Retient l'envoi `key` : [`HeldSends::cancel`] peut l'annuler jusqu'à
    /// la fin de [`HeldSends::wait`]. `None` si cette clé est déjà retenue :
    /// le même message envoyé deux fois, que l'appelant refuse (la remplacer
    /// rendrait le premier envoi impossible à annuler).
    pub(crate) fn hold(&self, key: &str) -> Option<Arc<AtomicBool>> {
        match self.lock().entry(key.to_owned()) {
            Entry::Occupied(_) => None,
            Entry::Vacant(slot) => Some(Arc::clone(slot.insert(Arc::new(AtomicBool::new(false))))),
        }
    }

    /// Annule un envoi encore retenu. `false` s'il est déjà parti, ou inconnu :
    /// la décision est prise sous le même verrou que la fin du délai, un envoi
    /// n'est donc jamais à la fois annulé et envoyé.
    pub(crate) fn cancel(&self, key: &str) -> bool {
        self.lock().get(key).is_some_and(|flag| {
            flag.store(true, Ordering::SeqCst);
            true
        })
    }

    /// Attend `delay` (au plus [`MAX_DELAY`]), en sortant dès que l'envoi est
    /// annulé, puis le retire de la liste : son sort est alors fixé.
    pub(crate) fn wait(&self, key: &str, flag: &AtomicBool, delay: Duration) -> Outcome {
        let end = Instant::now() + delay.min(MAX_DELAY);
        while !flag.load(Ordering::SeqCst) {
            let left = end.saturating_duration_since(Instant::now());
            if left.is_zero() {
                break;
            }
            std::thread::sleep(left.min(POLL));
        }
        self.release(key)
    }

    /// Fin du délai : l'envoi quitte la liste ; annulé si on l'a demandé avant.
    fn release(&self, key: &str) -> Outcome {
        match self.lock().remove(key) {
            Some(flag) if flag.load(Ordering::SeqCst) => Outcome::Cancelled,
            _ => Outcome::Send,
        }
    }

    /// La liste ne porte aucun invariant entre ses entrées : après une panique
    /// d'un autre fil, elle reste utilisable telle quelle.
    fn lock(&self) -> MutexGuard<'_, HashMap<String, Arc<AtomicBool>>> {
        self.held.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Sans attente réelle : délai nul, ou annulation demandée avant d'attendre
    // (l'attente regarde l'annulation avant de dormir). Les tests ne dépendent
    // donc pas de la vitesse de la machine.

    #[test]
    fn w1_sans_annulation_le_message_part() {
        let held = HeldSends::default();
        let flag = held.hold("k").expect("clé libre");
        assert_eq!(held.wait("k", &flag, Duration::ZERO), Outcome::Send);
        assert!(!held.cancel("k"), "parti : plus annulable");
        assert!(held.hold("k").is_some(), "clé libérée une fois l'envoi réglé");
    }

    #[test]
    fn w1_annule_avant_la_fin_du_delai() {
        let held = HeldSends::default();
        let flag = held.hold("k").expect("clé libre");
        assert!(held.cancel("k"), "annulation acceptée");
        // Délai démesuré : l'attente s'arrête aussitôt, l'envoi est annulé.
        assert_eq!(held.wait("k", &flag, Duration::from_secs(3600)), Outcome::Cancelled);
        assert!(!held.cancel("k"), "retiré de la liste une fois réglé");
    }

    #[test]
    fn w1_annulation_d_un_autre_fil() {
        let held = Arc::new(HeldSends::default());
        let flag = held.hold("k").expect("clé libre");
        let cancelled = {
            let held = Arc::clone(&held);
            std::thread::spawn(move || held.cancel("k")).join().expect("fil d'annulation")
        };
        assert!(cancelled, "annulation acceptée depuis un autre fil");
        assert_eq!(held.wait("k", &flag, MAX_DELAY), Outcome::Cancelled);
    }

    #[test]
    fn w1_cle_inconnue_ou_deja_retenue() {
        let held = HeldSends::default();
        assert!(!held.cancel("inconnue"), "rien à annuler");
        let flag = held.hold("k").expect("clé libre");
        assert!(held.hold("k").is_none(), "même message envoyé deux fois : refusé");
        assert!(held.cancel("k"), "le premier envoi reste annulable");
        assert_eq!(held.wait("k", &flag, Duration::ZERO), Outcome::Cancelled);
    }
}
