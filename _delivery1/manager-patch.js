// Consegna 1 — PATCH MIRATA per js/manager.js
//
// Questa non è una versione completa del file: sono 2 edit atomici da applicare
// a js/manager.js esistente.

// ============================================================
// EDIT 1 — in loadManagerData(), rimpiazza la chiamata
//   await loadDashboardUpcomingKpis(today);
//   await loadDashboardCreditsKpis();
// con:
//   await loadPanoramicaDefaultIfEmpty();
// e lascia invariato il resto.
// ------------------------------------------------------------
// async function loadPanoramicaDefaultIfEmpty() {
//   // Se la nuova toolbar è presente nel DOM, inizializza la Panoramica
//   if (document.getElementById('pano-overview') && typeof panoramicaInit === 'function') {
//     panoramicaInit();
//   } else {
//     // Fallback al vecchio comportamento se il nuovo HTML non è ancora stato deployato
//     if (typeof loadDashboardUpcomingKpis === 'function') await loadDashboardUpcomingKpis(todayStr());
//     if (typeof loadDashboardCreditsKpis === 'function') await loadDashboardCreditsKpis();
//   }
// }


// ============================================================
// EDIT 2 — in managerTab(tab, btn), aggiungi un hook per 'panoramica'
// dopo la riga `panel.classList.add('active');`:
//
//   if (tab === 'panoramica' && typeof panoramicaInit === 'function') panoramicaInit();
// ------------------------------------------------------------
//
// Il diff testuale finale in managerTab sarà:
//
//   function managerTab(tab, btn) {
//     document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
//     const panel = document.getElementById('mtab-' + tab);
//     panel.classList.add('active');
//     document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
//     if (btn) btn.classList.add('active');
//     if (tab === 'panoramica' && typeof panoramicaInit === 'function') panoramicaInit(); // ← NUOVA RIGA
//     if (tab === 'email') loadEmailTemplates();
//     if (tab === 'prenotazioni') loadPrenotazioni();
//     if (tab === 'log') {
//       …
//     }
//     enhanceDateInputs(panel);
//   }
