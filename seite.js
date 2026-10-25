/* ══════════════════════════════════════════════
   Knopf Immobilien — Verhalten der Seite
   ══════════════════════════════════════════════ */

'use strict';

/* ──────────────────────────────────────────────
   HIER ÄNDERN — Preise und Empfängeradresse
   ──────────────────────────────────────────────
   Die Preisregel ist am 24.08.2026 von Jim Knopf freigegeben,
   Mindestsatz für kleine Anlagen, Anzeige als Spanne und fester
   Grundsatz ohne Baujahr am 25.10.2026.
   Alle Beträge netto, pro Einheit und Monat. Wer sie ändert,
   ändert damit auch das, was der Rechner auf der Startseite
   ausweist — vorher mit Jim abstimmen.                           */

const PREISE = {
  // Grundsatz je Einheit und Monat, netto, bezogen auf drei Einheiten.
  // Das Baujahr fließt seit 25.10.2026 nicht mehr in den Rechner ein,
  // sondern erst ins schriftliche Angebot (Feld im Kontaktformular).
  grundsatz:       41.00,

  mindestEinheiten:    3,   // darunter nimmt Knopf Immobilien keine Anlage an
  hoechstEinheiten:  120,   // Ende des Reglers

  // Mengeneffekt: Bei der größten Anlage sinkt der Satz auf diesen Anteil
  // des Dreier-Satzes. Dazwischen läuft es weich, nicht in Stufen.
  anteilBeiHoechstzahl: 0.58,

  // Kleine Anlagen: Bei 3 bis 4 Einheiten mindestens dieser Satz je Einheit.
  // Von 5 bis 10 Einheiten gleitet der Satz zurück auf die Kurve oben,
  // ab 10 Einheiten gilt allein die Kurve.
  mindestSatzKlein: 50.00,
  kleinBis:            4,
  uebergangBis:       10,

  // Angezeigt wird eine Spanne: vom Richtwert bis zu diesem Aufschlag darüber.
  spanneNachOben:   0.15,

  // Zusatzleistungen, getrennt ausgewiesen. Sie verändern den Grundsatz oben
  // nicht, damit die Spanne von 31 bis 51 Euro belastbar bleibt.
  sondereigentum: 8.00,
  aufzug:         1.50,
  gewerbe:        2.00
};

const EMPFAENGER = 'info@knopfimmobilien.de';

/* Wohin die Anfrage geht. Der erste eingerichtete Weg gewinnt;
   ist keiner eingerichtet, öffnet sich eine vorbereitete E-Mail im
   Programm des Besuchers.

   IM BETRIEB seit 26.09.2026: Weg B, Jims Supabase-Projekt in Frankfurt
   (Tabelle „anfragen"). Besucher dürfen dort nur einfügen, nie lesen.
   Scheitert die Übertragung, springt das E-Mail-Programm ein.
   Wird das umgestellt, muss der Abschnitt „Anfrageformular"
   in datenschutz.html mitgeändert werden.

   Weg A — eigener Webspace mit PHP:
       ANFRAGE_ZIEL = 'https://knopfimmobilien.de/verwaltung/anfrage.php'

   Weg B — Supabase: beide Werte aus dem Projekt eintragen
       (Project Settings → API). Dieselben Werte wie in verwaltung.js.   */

const ANFRAGE_ZIEL        = '';
const SUPABASE_URL        = 'https://bullyvdntyswiixngtzu.supabase.co';
const SUPABASE_SCHLUESSEL = 'sb_publishable_t54MOAqmBy22rpbP5wNS2w_TCqO9xG8';

/* ────────────────────────────────────────────── */

const euro = new Intl.NumberFormat('de-DE', {
  style: 'currency', currency: 'EUR', maximumFractionDigits: 0
});
const euroGenau = new Intl.NumberFormat('de-DE', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 2
});

const ruhig = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ══ Menü auf schmalen Bildschirmen ══ */

(function menue() {
  const schalter = document.querySelector('.kopf__schalter');
  const nav = document.querySelector('.kopf__nav');
  if (!schalter || !nav) return;

  schalter.addEventListener('click', () => {
    const offen = nav.classList.toggle('kopf__nav--offen');
    schalter.setAttribute('aria-expanded', String(offen));
  });
  nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    nav.classList.remove('kopf__nav--offen');
    schalter.setAttribute('aria-expanded', 'false');
  }));
})();

/* ══ Angebotsrechner ══ */

const rechner = (function () {
  const schieberEinheiten = document.getElementById('einheiten');
  if (!schieberEinheiten) return null;

  const anzeigeEinheiten = document.getElementById('einheiten-wert');
  const ausgabeProEinheit = document.getElementById('preis-einheit');
  const ausgabeZusatz = document.getElementById('preis-zusatz');
  const zeileZusatz = document.getElementById('zusatz-zeile');
  const ausgabeGesamt = document.getElementById('preis-gesamt');

  /* Mengeneffekt: 1,0 bei drei Einheiten, weich fallend bis zum Anteil
     bei der Höchstzahl. Logarithmisch, weil der Aufwand je Einheit
     anfangs stark und später kaum noch sinkt. */
  const nenner = Math.log(PREISE.hoechstEinheiten / PREISE.mindestEinheiten);
  function mengenfaktor(anzahl) {
    const n = Math.max(anzahl, PREISE.mindestEinheiten);
    const abfall = (1 - PREISE.anteilBeiHoechstzahl) / nenner;
    return Math.max(1 - abfall * Math.log(n / PREISE.mindestEinheiten),
                    PREISE.anteilBeiHoechstzahl);
  }

  function lesen() {
    return {
      anzahl: Math.max(Number(schieberEinheiten.value), PREISE.mindestEinheiten),
      umfang: document.querySelector('input[name="umfang"]:checked').value,
      zusatz: [...document.querySelectorAll('input[name="zusatz"]:checked')].map(e => e.value)
    };
  }

  /* Mindestsatz für kleine Anlagen: bis „kleinBis" Einheiten voll,
     danach bis „uebergangBis" in einer Kurve auslaufend. Quadratisch statt
     geradlinig, damit der Gesamtpreis mit jeder Einheit steigt und eine
     größere Anlage nie insgesamt billiger wird als eine kleinere. */
  function mitMindestsatz(satz, anzahl) {
    const rest = (PREISE.uebergangBis - anzahl) / (PREISE.uebergangBis - PREISE.kleinBis);
    const gewicht = anzahl <= PREISE.kleinBis ? 1
      : anzahl >= PREISE.uebergangBis ? 0
      : rest * rest;
    const ziel = Math.max(satz, PREISE.mindestSatzKlein);
    return satz + gewicht * (ziel - satz);
  }

  function rechnen() {
    const e = lesen();
    const grund = mitMindestsatz(
      PREISE.grundsatz * mengenfaktor(e.anzahl), e.anzahl);

    let zusatz = 0;
    if (e.umfang === 'weg_sev') zusatz += PREISE.sondereigentum;
    if (e.zusatz.includes('aufzug')) zusatz += PREISE.aufzug;
    if (e.zusatz.includes('gewerbe')) zusatz += PREISE.gewerbe;

    return { ...e, grund, zusatz, gesamt: (grund + zusatz) * e.anzahl };
  }

  function fuellstand(schieber) {
    const min = Number(schieber.min), max = Number(schieber.max);
    return (Number(schieber.value) - min) / (max - min) * 100 + '%';
  }

  function zeichnen() {
    const e = rechnen();

    anzeigeEinheiten.textContent = e.anzahl;

    // Spanne statt Festpreis: Richtwert bis Richtwert + Aufschlag
    const zahl = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
    const spanne = (von, bis) => `${zahl.format(von)} – ${zahl.format(bis)} €`;
    const grundVon = Math.round(e.grund);
    const grundBis = Math.round(e.grund * (1 + PREISE.spanneNachOben));
    ausgabeProEinheit.textContent = spanne(grundVon, grundBis);

    if (e.zusatz > 0) {
      zeileZusatz.hidden = false;
      ausgabeZusatz.textContent = '+ ' + euroGenau.format(e.zusatz);
    } else {
      zeileZusatz.hidden = true;
    }

    const aufZehn = x => Math.round(x / 10) * 10;
    ausgabeGesamt.textContent = spanne(
      aufZehn((e.grund + e.zusatz) * e.anzahl),
      aufZehn((e.grund * (1 + PREISE.spanneNachOben) + e.zusatz) * e.anzahl));

    schieberEinheiten.style.setProperty('--fuellstand', fuellstand(schieberEinheiten));
  }

  document.querySelectorAll('#rechner input').forEach(feld => {
    feld.addEventListener('input', zeichnen);
    feld.addEventListener('change', zeichnen);
  });
  zeichnen();

  return { rechnen };
})();

/* ══ Werte aus dem Rechner in das Formular übernehmen ══ */

(function uebernehmen() {
  const knopf = document.getElementById('rechner-uebernehmen');
  const formular = document.getElementById('anfrage');
  if (!knopf || !formular || !rechner) return;

  knopf.addEventListener('click', () => {
    const e = rechner.rechnen();
    formular.elements.einheiten.value = e.anzahl;
    formular.elements.umfang.value =
      e.umfang === 'weg_sev' ? 'WEG plus Sondereigentum' : 'Nur WEG-Verwaltung';
    formular.elements.umfang.dispatchEvent(new Event('change'));

    // rechnen() liefert unter „zusatz“ den Betrag, nicht die Auswahl —
    // deshalb die angehakten Besonderheiten direkt lesen
    const gewaehlt = [...document.querySelectorAll('#rechner input[name="zusatz"]:checked')]
      .map(feld => feld.value);
    const merkmale = [];
    if (gewaehlt.includes('aufzug'))  merkmale.push('Aufzug vorhanden');
    if (gewaehlt.includes('gewerbe')) merkmale.push('Gewerbeeinheiten im Objekt');
    if (merkmale.length) {
      const feld = formular.elements.nachricht;
      const zusatzText = 'Besonderheiten: ' + merkmale.join(', ') + '.';
      feld.value = feld.value ? feld.value.replace(/\s*Besonderheiten:.*$/, '').trim() +
        '\n' + zusatzText : zusatzText;
    }

    document.getElementById('kontakt')
      .scrollIntoView({ behavior: ruhig ? 'auto' : 'smooth', block: 'start' });
    setTimeout(() => formular.elements.name.focus(), ruhig ? 0 : 600);
  });
})();

/* ══ Anfrageformular ══ */

(function anfrage() {
  const formular = document.getElementById('anfrage');
  if (!formular) return;
  const meldung = document.getElementById('anfrage-meldung');

  // Nur bei der WEG-Verwaltung ist die Zahl der Einheiten Pflicht (ab drei).
  // Bei Verkauf, Vermietung oder Bauvorhaben ist sie freiwillig.
  const WEG_ANLIEGEN = ['Nur WEG-Verwaltung', 'WEG plus Sondereigentum'];
  const istWeg = () => WEG_ANLIEGEN.includes(formular.elements.umfang.value);

  const regeln = {
    name:     w => w.trim().length >= 2      || 'Bitte tragen Sie Ihren Namen ein.',
    email:    w => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(w.trim()) || 'Diese E-Mail-Adresse sieht nicht vollständig aus.',
    ort:      w => w.trim().length >= 2      || 'Bitte nennen Sie den Ort der Immobilie.',
    einheiten:w => {
      if (istWeg()) {
        return (Number(w) >= 3 && Number(w) <= 500)
          || 'Für die WEG-Verwaltung ab drei Einheiten — darunter übernehme ich keine Verwaltung.';
      }
      if (w.trim() === '') return true;
      return (Number(w) >= 1 && Number(w) <= 500) || 'Bitte eine Zahl zwischen 1 und 500 eintragen.';
    }
  };

  // Pflicht-Sternchen und Prüfung der Einheiten an das Anliegen anpassen
  const einheitenFeld = formular.elements.einheiten;
  const pflichtStern = document.getElementById('einheiten-pflicht');
  function anliegenAnwenden() {
    const weg = istWeg();
    einheitenFeld.required = weg;
    if (pflichtStern) pflichtStern.hidden = !weg;
    if (einheitenFeld.closest('.eingabe').classList.contains('eingabe--fehler')) feldPruefen(einheitenFeld);
  }
  formular.elements.umfang.addEventListener('change', anliegenAnwenden);
  formular.addEventListener('reset', () => setTimeout(anliegenAnwenden, 0));

  // Links in den Leistungskarten wählen das passende Anliegen vor
  document.querySelectorAll('a[data-anliegen]').forEach(link => {
    link.addEventListener('click', () => {
      formular.elements.umfang.value = link.dataset.anliegen;
      anliegenAnwenden();
    });
  });

  function fehlerZeigen(feld, text) {
    const traeger = feld.closest('.eingabe');
    const platz = traeger
      ? traeger.querySelector('.eingabe__fehler')
      : document.querySelector(`[data-fuer="${feld.name}"]`);
    if (platz) platz.textContent = text || '';
    if (traeger) traeger.classList.toggle('eingabe--fehler', Boolean(text));
    feld.setAttribute('aria-invalid', text ? 'true' : 'false');
  }

  function feldPruefen(feld) {
    const regel = regeln[feld.name];
    if (!regel) return true;
    const ergebnis = regel(feld.value);
    fehlerZeigen(feld, ergebnis === true ? '' : ergebnis);
    return ergebnis === true;
  }

  anliegenAnwenden();

  Object.keys(regeln).forEach(name => {
    const feld = formular.elements[name];
    if (!feld) return;
    feld.addEventListener('blur', () => feldPruefen(feld));
    feld.addEventListener('input', () => {
      if (feld.closest('.eingabe').classList.contains('eingabe--fehler')) feldPruefen(feld);
    });
  });

  formular.addEventListener('submit', ereignis => {
    ereignis.preventDefault();
    meldung.className = 'anfrage__meldung';

    // Spamfalle: ausgefüllt heißt Bot — leise abbrechen
    if (formular.elements.webseite.value.trim() !== '') return;

    let sauber = true;
    let erstesFehlerfeld = null;
    Object.keys(regeln).forEach(name => {
      const feld = formular.elements[name];
      if (feld && !feldPruefen(feld)) {
        sauber = false;
        if (!erstesFehlerfeld) erstesFehlerfeld = feld;
      }
    });

    const zustimmung = formular.elements.datenschutz;
    if (!zustimmung.checked) {
      fehlerZeigen(zustimmung, 'Ohne Ihr Einverständnis kann ich die Anfrage nicht bearbeiten.');
      sauber = false;
      if (!erstesFehlerfeld) erstesFehlerfeld = zustimmung;
    } else {
      fehlerZeigen(zustimmung, '');
    }

    if (!sauber) {
      meldung.textContent = 'Bitte prüfen Sie die markierten Felder.';
      meldung.classList.add('anfrage__meldung--fehler');
      erstesFehlerfeld.focus();
      return;
    }

    const d = Object.fromEntries(new FormData(formular).entries());
    d.datenschutz = zustimmung.checked;

    if (ANFRAGE_ZIEL) {
      absendenPerLeitung(d, ANFRAGE_ZIEL, rumpfFuerLeitung(d));
    } else if (SUPABASE_URL && SUPABASE_SCHLUESSEL) {
      absendenPerLeitung(
        d,
        SUPABASE_URL + '/rest/v1/anfragen',
        rumpfFuerDatenbank(d),
        {
          apikey: SUPABASE_SCHLUESSEL,
          Authorization: 'Bearer ' + SUPABASE_SCHLUESSEL,
          Prefer: 'return=minimal',
        }
      );
    } else {
      absendenPerMailprogramm(d);
    }
  });

  /* Was der eigene Webspace erwartet */
  function rumpfFuerLeitung(d) {
    return d;
  }

  /* Was die Datenbank erwartet — Feldnamen der Tabelle,
     Stand und Notiz bleiben weg, die setzt nur die Verwaltung. */
  function rumpfFuerDatenbank(d) {
    return {
      name:      d.name,
      email:     d.email,
      telefon:   d.telefon || '',
      ort:       d.ort,
      einheiten: d.einheiten ? Number(d.einheiten) : null,
      baujahr:   d.baujahr ? Number(d.baujahr) : null,
      umfang:    d.umfang || '',
      nachricht: d.nachricht || '',
    };
  }

  /* Weg 1: direkt an die Anfragenverwaltung.
     Der Absender merkt nichts von E-Mail. */
  async function absendenPerLeitung(d, ziel, rumpf, zusatzKopf = {}) {
    const knopf = formular.querySelector('button[type="submit"]');
    const beschriftung = knopf.textContent;
    knopf.disabled = true;
    knopf.textContent = 'Wird gesendet …';
    meldung.textContent = '';

    try {
      const antwort = await fetch(ziel, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...zusatzKopf },
        body: JSON.stringify(rumpf)
      });
      const ergebnis = await antwort.json().catch(() => ({}));

      // Die Datenbank meldet Erfolg nur über den Status, ohne Inhalt
      if (antwort.ok && (ergebnis === null || ergebnis.ok || antwort.status === 201 || antwort.status === 204)) {
        formular.reset();
        document.querySelectorAll('.eingabe__fehler').forEach(f => (f.textContent = ''));
        document.querySelectorAll('.eingabe--fehler').forEach(f => f.classList.remove('eingabe--fehler'));
        meldung.textContent =
          'Vielen Dank, Ihre Anfrage ist eingegangen. Ich melde mich in Kürze bei Ihnen.';
        meldung.classList.add('anfrage__meldung--gut');
        return;
      }

      // Die Gegenstelle hat einzelne Felder bemängelt
      if (antwort.status === 422 && ergebnis.fehler && typeof ergebnis.fehler === 'object') {
        Object.entries(ergebnis.fehler).forEach(([name, text]) => {
          const feld = formular.elements[name];
          if (feld) fehlerZeigen(feld, text);
        });
        meldung.textContent = 'Bitte prüfen Sie die markierten Felder.';
        meldung.classList.add('anfrage__meldung--fehler');
        return;
      }

      throw new Error('unerwartete Antwort');
    } catch (fehler) {
      // Leitung gestört: nichts verlieren, auf das E-Mail-Programm ausweichen
      meldung.textContent =
        'Die Übertragung hat nicht geklappt. Ich öffne stattdessen Ihr E-Mail-Programm.';
      meldung.classList.add('anfrage__meldung--fehler');
      setTimeout(() => absendenPerMailprogramm(d, true), 900);
    } finally {
      knopf.disabled = false;
      knopf.textContent = beschriftung;
    }
  }

  /* Weg 2: vorbereitete E-Mail, wenn keine Verwaltung eingerichtet ist */
  function absendenPerMailprogramm(d, stillschweigend = false) {
    const betreff = `Anfrage ${d.umfang || 'Knopf Immobilien'} — ${d.ort}` +
      (d.einheiten ? `, ${d.einheiten} Einheiten` : '');
    const rumpf = [
      `Name:       ${d.name}`,
      `E-Mail:     ${d.email}`,
      `Telefon:    ${d.telefon || '—'}`,
      `Ort:        ${d.ort}`,
      `Einheiten:  ${d.einheiten || '—'}`,
      `Baujahr:    ${d.baujahr || '—'}`,
      `Anliegen:   ${d.umfang}`,
      '',
      'Nachricht:',
      d.nachricht || '—',
      '',
      '— gesendet über knopfimmobilien.de'
    ].join('\n');

    window.location.href =
      `mailto:${EMPFAENGER}?subject=${encodeURIComponent(betreff)}&body=${encodeURIComponent(rumpf)}`;

    if (!stillschweigend) {
      meldung.textContent =
        'Ihr E-Mail-Programm öffnet sich mit der fertigen Nachricht. Bitte dort noch auf Senden klicken.';
      meldung.classList.add('anfrage__meldung--gut');
    }
  }
})();

/* ══ Abschnitte beim Scrollen einblenden ══ */

(function einblenden() {
  if (ruhig || !('IntersectionObserver' in window)) return;

  const ziele = document.querySelectorAll(
    '.leiste > div, .karte, .anspruch__text, .anspruch figure, ' +
    '.schritte li, .frage, .block > h2, .block > .einleitung, ' +
    '.rechner, .anfrage, .kontakt'
  );
  ziele.forEach(el => el.classList.add('auftritt'));

  const beobachter = new IntersectionObserver((eintraege, selbst) => {
    eintraege.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.classList.add('auftritt--da');
      selbst.unobserve(e.target);
    });
  }, { threshold: 0, rootMargin: '0px 0px -5% 0px' });

  ziele.forEach((el, i) => {
    el.style.setProperty('--verzug', (i % 4) * 70 + 'ms');
    beobachter.observe(el);
  });

  /* Sicherheitsnetz: Was im sichtbaren Bereich steht, wird auf jeden Fall
     gezeigt — auch wenn der Beobachter nicht ausgelöst hat. Das greift beim
     Sprung über eine Adresse wie /#kontakt und wenn sehr schnell gescrollt
     wird. Ohne dieses Netz könnte Inhalt dauerhaft unsichtbar bleiben. */
  function sichtbaresZeigen() {
    document.querySelectorAll('.auftritt:not(.auftritt--da)').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) {
        el.classList.add('auftritt--da');
        beobachter.unobserve(el);
      }
    });
  }

  window.addEventListener('load', sichtbaresZeigen);
  window.addEventListener('hashchange', () => setTimeout(sichtbaresZeigen, 60));
  setTimeout(sichtbaresZeigen, 1200);
})();

/* ══ Aktiven Menüpunkt mitführen ══ */

(function menuepunkt() {
  const punkte = [...document.querySelectorAll('.kopf__nav a[href^="#"]')]
    .filter(a => !a.classList.contains('knopf'));
  if (!punkte.length || !('IntersectionObserver' in window)) return;

  const zuPunkt = new Map();
  punkte.forEach(a => {
    const ziel = document.querySelector(a.getAttribute('href'));
    if (ziel) zuPunkt.set(ziel, a);
  });

  const beobachter = new IntersectionObserver(eintraege => {
    eintraege.forEach(e => {
      const a = zuPunkt.get(e.target);
      if (!a) return;
      if (e.isIntersecting) {
        punkte.forEach(p => p.classList.remove('kopf__nav--aktiv'));
        a.classList.add('kopf__nav--aktiv');
      }
    });
  }, { rootMargin: '-45% 0px -50% 0px' });

  zuPunkt.forEach((_, ziel) => beobachter.observe(ziel));
})();

/* ══ Immer nur eine Frage offen ══ */

(function fragen() {
  const alle = [...document.querySelectorAll('.frage')];
  alle.forEach(f => f.addEventListener('toggle', () => {
    if (f.open) alle.filter(a => a !== f && a.open).forEach(a => { a.open = false; });
  }));
})();

/* ══════════════════════════════════════════════
   Scroll-Effekte
   Alles über transform und opacity, damit der Browser
   nichts neu berechnen muss. Bei reduzierter Bewegung
   bleibt die Seite still.
   ══════════════════════════════════════════════ */

(function scrolleffekte() {
  if (ruhig) return;

  const kopf = document.querySelector('.kopf');
  const balken = document.getElementById('lesefortschritt');

  /* Bilder, die sich langsamer bewegen als die Seite */
  const langsam = [
    { el: document.querySelector('.band img'),    staerke: 0.16 },
    { el: document.querySelector('.block__grund'), staerke: 0.10 }
  ].filter(z => z.el);

  /* Bilder, die beim Durchscrollen sanft aus dem Zoom laufen */
  const zoom = [...document.querySelectorAll('.anspruch figure img')];

  let laeuft = false;

  function zeichnen() {
    laeuft = false;
    const hoehe = window.innerHeight;
    const oben = window.scrollY;

    /* Kopfzeile wird kompakt, sobald man losscrollt */
    if (kopf) kopf.classList.toggle('kopf--klein', oben > 60);

    /* Lesefortschritt */
    if (balken) {
      const gesamt = document.documentElement.scrollHeight - hoehe;
      balken.style.transform = `scaleX(${gesamt > 0 ? oben / gesamt : 0})`;
    }

    /* Langsamere Bilder */
    langsam.forEach(({ el, staerke }) => {
      const r = el.parentElement.getBoundingClientRect();
      if (r.bottom < -200 || r.top > hoehe + 200) return;
      const mitte = r.top + r.height / 2 - hoehe / 2;
      el.style.transform = `translate3d(0, ${(-mitte * staerke).toFixed(1)}px, 0)`;
    });

    /* Zoom läuft aus, während das Bild durchs Bild wandert */
    zoom.forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > hoehe) return;
      // 0 = Bild betritt den Bildschirm unten, 1 = es hat die Mitte erreicht
      const weg = Math.min(Math.max((hoehe - r.top) / (hoehe * 0.85), 0), 1);
      el.style.transform = `scale(${(1.09 - weg * 0.09).toFixed(4)})`;
    });
  }

  function anstossen() {
    if (laeuft) return;
    laeuft = true;
    requestAnimationFrame(zeichnen);
  }

  window.addEventListener('scroll', anstossen, { passive: true });
  window.addEventListener('resize', anstossen);

  /* In einem Hintergrund-Tab hält der Browser Scroll-Ereignisse und
     Bildwiederholung an. Kommt der Besucher zurück, kann die Seite
     inzwischen ganz woanders stehen — deshalb einmal frisch zeichnen. */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') zeichnen();
  });

  zeichnen();
})();
