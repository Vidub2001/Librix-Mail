//! Conversations (lot U1) : messages d'une même discussion, d'après leurs
//! en-têtes `Message-ID`, `In-Reply-To` et `References` (RFC 5322, § 3.6.4),
//! messages envoyés compris. En secours, une réponse (« Re: », « TR: »…)
//! rejoint les messages de même objet avec qui elle partage un correspondant
//! (décision de Fabrice du 24 novembre 2026) : deux « Facture » d'un même
//! expéditeur restent séparées, aucune n'étant une réponse.
//!
//! Rien ici ne touche au réseau ni au cache : de quoi tester le regroupement seul.

use std::collections::{HashMap, HashSet};

/// Identifiants gardés par message dans `References` : le premier (début de
/// la discussion) et les derniers. Assez pour relier, sans laisser un en-tête
/// démesuré grossir le cache.
const MAX_PARENTS: usize = 30;
/// Destinataires gardés par message (`To` et `Cc`).
const MAX_RECIPIENTS: usize = 50;
/// Longueur maximale d'un identifiant ou d'une adresse : au-delà, ignoré.
const MAX_TOKEN: usize = 250;
/// Messages d'un même objet comparés entre eux, au plus : l'objet « Re: » de
/// milliers de messages ne fait pas exploser le calcul.
const MAX_SAME_SUBJECT: usize = 200;

/// En-têtes de discussion d'un message, tels que gardés dans le cache.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ThreadHeaders {
    /// `Message-ID`, sans chevrons ; vide s'il manque.
    pub message_id: String,
    /// Messages auxquels il se rattache : `References` puis `In-Reply-To`, sans
    /// doublon ; le regroupement n'en suit que le premier et le dernier (`group`).
    pub parents: Vec<String>,
    /// Adresses de `To` et `Cc`, en minuscules.
    pub recipients: Vec<String>,
}

/// En-têtes repliés sur une ligne (RFC 5322, § 2.2.3) : (nom en minuscules, valeur).
fn unfolded(block: &[u8]) -> Vec<(String, String)> {
    let text = String::from_utf8_lossy(block);
    let mut fields: Vec<(String, String)> = Vec::new();
    for line in text.split('\n') {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            break;
        }
        if line.starts_with([' ', '\t']) {
            if let Some((_, value)) = fields.last_mut() {
                value.push(' ');
                value.push_str(line.trim());
            }
        } else if let Some((name, value)) = line.split_once(':') {
            fields.push((name.trim().to_ascii_lowercase(), value.trim().to_string()));
        }
    }
    fields
}

/// Identifiants `<…>` d'une valeur, sans chevrons ni espaces.
fn ids(value: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut rest = value;
    while let Some(start) = rest.find('<') {
        let after = &rest[start + 1..];
        let Some(end) = after.find('>') else { break };
        let id: String = after[..end].chars().filter(|c| !c.is_whitespace()).collect();
        if !id.is_empty() && id.len() <= MAX_TOKEN {
            found.push(id);
        }
        rest = &after[end + 1..];
    }
    found
}

/// Adresses d'une liste `To` ou `Cc`, en minuscules : `<adresse>` ou mot contenant « @ ».
fn addresses(value: &str) -> Vec<String> {
    value
        .split([',', ';', ' ', '\t', '<', '>', '"'])
        .filter(|w| w.contains('@') && w.len() <= MAX_TOKEN)
        .map(|w| w.trim_matches(|c: char| c == '(' || c == ')' || c == '\'').to_lowercase())
        .filter(|w| !w.is_empty())
        .collect()
}

/// Lit les en-têtes de discussion d'un bloc d'en-têtes (réponse `HEADER.FIELDS`).
pub(crate) fn thread_headers(block: &[u8]) -> ThreadHeaders {
    let mut headers = ThreadHeaders::default();
    let mut references = Vec::new();
    let mut in_reply_to = Vec::new();
    for (name, value) in unfolded(block) {
        match name.as_str() {
            "message-id" if headers.message_id.is_empty() => {
                headers.message_id = ids(&value).into_iter().next().unwrap_or_default();
            }
            "references" => references.extend(ids(&value)),
            "in-reply-to" => in_reply_to.extend(ids(&value)),
            "to" | "cc" => headers.recipients.extend(addresses(&value)),
            _ => {}
        }
    }
    // Le début de la discussion et les derniers messages, si la liste est longue.
    if references.len() > MAX_PARENTS {
        let tail = references.split_off(references.len() - (MAX_PARENTS - 1));
        references.truncate(1);
        references.extend(tail);
    }
    let mut seen = HashSet::new();
    headers.parents = references.into_iter().chain(in_reply_to).filter(|id| *id != headers.message_id && seen.insert(id.clone())).collect();
    let mut seen = HashSet::new();
    headers.recipients.retain(|a| seen.insert(a.clone()));
    headers.recipients.truncate(MAX_RECIPIENTS);
    headers
}

/// Préfixes de réponse et de transfert, en minuscules (français, anglais, allemand, espagnol, nordiques).
const REPLY_PREFIXES: [&str; 10] = ["re", "fw", "fwd", "tr", "trans", "aw", "wg", "rv", "sv", "vs"];

/// Objet sans ses préfixes de réponse (« Re: », « TR : », « Re[2]: »…), en
/// minuscules et espaces réduits ; et s'il en avait au moins un.
pub(crate) fn base_subject(subject: &str) -> (String, bool) {
    let mut rest = subject.trim();
    let mut replied = false;
    while let Some((head, tail)) = rest.split_once(':') {
        let word = head.trim_end();
        // « Re[2] » ou « Re(2) » : le compteur est ignoré.
        let word = word.split(['[', '(']).next().unwrap_or(word);
        if !REPLY_PREFIXES.contains(&word.to_lowercase().as_str()) {
            break;
        }
        replied = true;
        rest = tail.trim_start();
    }
    let base = rest.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    (base, replied)
}

/// Un message, pour le regroupement.
#[derive(Debug, Clone, Default)]
pub(crate) struct ThreadMessage {
    pub headers: ThreadHeaders,
    pub subject: String,
    pub from_email: String,
}

/// Ensembles disjoints (union-find), avec compression des chemins.
struct Sets(Vec<usize>);

impl Sets {
    fn find(&mut self, mut x: usize) -> usize {
        let mut root = x;
        while self.0[root] != root {
            root = self.0[root];
        }
        while self.0[x] != root {
            let next = self.0[x];
            self.0[x] = root;
            x = next;
        }
        root
    }

    fn union(&mut self, a: usize, b: usize) {
        let (a, b) = (self.find(a), self.find(b));
        if a != b {
            // Le plus petit indice reste la racine : résultat stable d'un calcul à l'autre.
            let (low, high) = if a < b { (a, b) } else { (b, a) };
            self.0[high] = low;
        }
    }
}

/// Conversation de chaque message : un numéro par conversation, de 0 à n − 1,
/// dans l'ordre où elles apparaissent dans `messages`. `own` : adresses de
/// l'utilisateur, en minuscules, jamais comptées comme correspondant en commun.
pub(crate) fn group(messages: &[ThreadMessage], own: &HashSet<String>) -> Vec<usize> {
    let count = messages.len();
    let mut sets = Sets((0..count).collect());
    // Identifiants connus : un nœud par identifiant, ajouté après les messages.
    // Deux messages qui citent le même parent absent du cache sont ainsi reliés.
    let mut nodes: HashMap<&str, usize> = HashMap::new();
    for (i, m) in messages.iter().enumerate() {
        let h = &m.headers;
        // Parent direct (dernier : `In-Reply-To`, sinon la dernière référence) et
        // racine (première référence) seulement : une liste `References` forgée
        // relie au plus deux discussions, pas trente (relecture du lot U1). Les
        // références intermédiaires manquantes sont couvertes par la racine.
        let linked = [h.parents.first(), h.parents.last()];
        let ids =
            std::iter::once(h.message_id.as_str()).filter(|id| !id.is_empty()).chain(linked.into_iter().flatten().map(String::as_str));
        for id in ids {
            let next = sets.0.len();
            let n = *nodes.entry(id).or_insert(next);
            if n == next {
                sets.0.push(next);
            }
            sets.union(i, n);
        }
    }
    // Secours : une réponse rejoint les messages de même objet avec qui elle partage un correspondant.
    let mut by_subject: HashMap<String, Vec<(usize, bool)>> = HashMap::new();
    for (i, m) in messages.iter().enumerate() {
        let (base, replied) = base_subject(&m.subject);
        if !base.is_empty() {
            let list = by_subject.entry(base).or_default();
            if list.len() < MAX_SAME_SUBJECT {
                list.push((i, replied));
            }
        }
    }
    let correspondents = |m: &ThreadMessage| -> HashSet<String> {
        std::iter::once(m.from_email.to_lowercase())
            .chain(m.headers.recipients.iter().cloned())
            .filter(|a| !a.is_empty() && !own.contains(a))
            .collect()
    };
    for list in by_subject.values() {
        if list.len() < 2 || !list.iter().any(|&(_, replied)| replied) {
            continue;
        }
        let people: Vec<HashSet<String>> = list.iter().map(|&(i, _)| correspondents(&messages[i])).collect();
        for (a, &(i, replied)) in list.iter().enumerate() {
            if !replied {
                continue;
            }
            for (b, &(j, _)) in list.iter().enumerate() {
                if a != b && !people[a].is_disjoint(&people[b]) {
                    sets.union(i, j);
                }
            }
        }
    }
    // Numéros consécutifs, dans l'ordre d'apparition.
    let mut numbers: HashMap<usize, usize> = HashMap::new();
    (0..count)
        .map(|i| {
            let root = sets.find(i);
            let next = numbers.len();
            *numbers.entry(root).or_insert(next)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(id: &str, parents: &[&str], subject: &str, from: &str, to: &[&str]) -> ThreadMessage {
        ThreadMessage {
            headers: ThreadHeaders {
                message_id: id.into(),
                parents: parents.iter().map(|p| (*p).to_string()).collect(),
                recipients: to.iter().map(|a| (*a).to_string()).collect(),
            },
            subject: subject.into(),
            from_email: from.into(),
        }
    }

    fn own() -> HashSet<String> {
        HashSet::from(["moi@exemple.fr".to_string()])
    }

    #[test]
    fn u1_en_tetes_lus_replies_et_sans_doublon() {
        let block = b"Message-ID: <c@x>\r\nReferences: <a@x>\r\n <b@x>\r\nIn-Reply-To: <b@x>\r\n\
To: \"Alice\" <Alice@Exemple.fr>, bob@exemple.fr\r\nCc: =?utf-8?q?Zo=C3=A9?= <zoe@exemple.fr>\r\n\r\nCorps <d@x>";
        let h = thread_headers(block);
        assert_eq!(h.message_id, "c@x");
        assert_eq!(h.parents, ["a@x", "b@x"], "In-Reply-To déjà dans References");
        assert_eq!(h.recipients, ["alice@exemple.fr", "bob@exemple.fr", "zoe@exemple.fr"]);
        assert_eq!(thread_headers(b"Subject: rien\r\n\r\n"), ThreadHeaders::default());
    }

    #[test]
    fn u1_references_longues_debut_et_fin_gardes() {
        let refs = (0..100).map(|i| format!("<r{i}@x>")).collect::<Vec<_>>().join(" ");
        let h = thread_headers(format!("References: {refs}\r\n\r\n").as_bytes());
        assert_eq!(h.parents.len(), MAX_PARENTS);
        assert_eq!(h.parents[0], "r0@x", "début de la discussion");
        assert_eq!(h.parents[MAX_PARENTS - 1], "r99@x", "message précédent");
    }

    #[test]
    fn u1_objet_sans_prefixes() {
        assert_eq!(base_subject("Re: TR : Re[2]:  Devis   cuisine"), ("devis cuisine".into(), true));
        assert_eq!(base_subject("AW: Angebot"), ("angebot".into(), true));
        assert_eq!(base_subject("Devis : cuisine"), ("devis : cuisine".into(), false), "deux-points d'un objet ordinaire");
        assert_eq!(base_subject("Re:"), (String::new(), true));
    }

    #[test]
    fn u1_regroupe_par_en_tetes_meme_parent_absent() {
        let messages = [
            msg("a@x", &[], "Devis", "alice@exemple.fr", &["moi@exemple.fr"]),
            msg("b@x", &["a@x"], "Re: Devis", "moi@exemple.fr", &["alice@exemple.fr"]),
            msg("z@x", &[], "Autre chose", "carl@exemple.fr", &["moi@exemple.fr"]),
            // Parent hors du cache (supprimé) : les deux réponses restent ensemble.
            msg("d@x", &["absent@x"], "Re: Vieux sujet", "dan@exemple.fr", &[]),
            msg("e@x", &["absent@x", "d@x"], "Re: Vieux sujet", "eve@exemple.fr", &[]),
            // Même message dans deux dossiers (Envoyés et boîte de réception).
            msg("b@x", &[], "Re: Devis", "moi@exemple.fr", &[]),
        ];
        assert_eq!(group(&messages, &own()), [0, 0, 1, 2, 2, 0]);
    }

    #[test]
    fn u1_references_forgees_relient_au_plus_deux_discussions() {
        let messages = [
            msg("a@x", &[], "Un", "a@exemple.fr", &[]),
            msg("b@x", &[], "Deux", "b@exemple.fr", &[]),
            msg("c@x", &[], "Trois", "c@exemple.fr", &[]),
            msg("d@x", &[], "Quatre", "d@exemple.fr", &[]),
            // Cite les quatre : rejoint la première (racine) et la dernière (parent direct) seulement.
            msg("f@x", &["a@x", "b@x", "c@x", "d@x"], "Piège", "f@exemple.fr", &[]),
            // Réponse dont les messages intermédiaires manquent : reliée par la racine.
            msg("r@x", &["b@x", "absent1@x", "absent2@x"], "Re: Deux", "b@exemple.fr", &[]),
        ];
        assert_eq!(group(&messages, &own()), [0, 1, 2, 0, 0, 1]);
    }

    #[test]
    fn u1_secours_par_objet_seulement_reponse_et_correspondant_commun() {
        let messages = [
            msg("", &[], "Facture", "boutique@exemple.fr", &["moi@exemple.fr"]),
            msg("", &[], "Facture", "boutique@exemple.fr", &["moi@exemple.fr"]),
            // Réponse sans en-têtes, au même correspondant : rejoint les deux factures.
            msg("", &[], "RE: facture", "moi@exemple.fr", &["boutique@exemple.fr"]),
            // Même objet, autre correspondant : reste seule (l'utilisateur ne compte pas).
            msg("", &[], "Re: Facture", "moi@exemple.fr", &["autre@exemple.fr"]),
        ];
        assert_eq!(group(&messages, &own()), [0, 0, 0, 1]);
        // Sans réponse, deux factures d'un même expéditeur restent séparées.
        assert_eq!(group(&messages[..2], &own()), [0, 1]);
    }
}
