//! Point d'entrée de Librix Mail : lance l'application (`librixmail_lib::run`).

// Évite une console supplémentaire sous Windows en mode release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    librixmail_lib::run();
}
