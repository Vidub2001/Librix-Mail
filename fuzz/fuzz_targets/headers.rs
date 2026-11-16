//! Les en-têtes d'un message reçu repris pour y répondre (`mail-core`).
#![no_main]

libfuzzer_sys::fuzz_target!(|data: &[u8]| {
    librixmail_lib::fuzz_api::headers(data);
});
