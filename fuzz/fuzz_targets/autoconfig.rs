//! Un document `clientConfig` : fichier publié par un domaine ou copie de l'ISPDB,
//! serveurs choisis, identifiant, nom et aide du fournisseur (lot I1).
#![no_main]

libfuzzer_sys::fuzz_target!(|data: &[u8]| {
    librixmail_lib::fuzz_api::autoconfig(data);
});
