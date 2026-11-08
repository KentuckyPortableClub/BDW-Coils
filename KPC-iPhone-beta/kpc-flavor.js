/* KPC flavor (Oct 28, HQ 'KPC LITE = GO'; Brandon: 'yes ft8 and 4').
   The nightly build overwrites this ONE line for the KPC Lite APK (build.yml → lite: true); the full app keeps lite: false.
   Lite = the logger, spots, FT8 + FT4, radio control, map, alerts, voice keyer. Left out: CW/RTTY/PSK31/HELL/SSTV/WSPR,
   APRS, the remote link, offline park packs and uploads (index.html skips those files; html[data-lite] hides their parts).
   ?lite=1 on the page = the same, for the tests. */
window.KPC_FLAVOR = { lite: false };
