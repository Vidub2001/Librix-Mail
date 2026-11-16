//! Une adresse reçue d'un serveur ou d'un message (relecture complète n° 47).
#![no_main]

libfuzzer_sys::fuzz_target!(|data: &[u8]| {
    librixmail_lib::fuzz_api::url(&String::from_utf8_lossy(data));
});
