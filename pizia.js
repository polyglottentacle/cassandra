/* Pizia · il cuore: legge un export di WhatsApp e ne calcola le statistiche.
   Gira tutto sul dispositivo: nessuna chiamata di rete, nessuna libreria esterna.
   Si usa nel browser (window.Pizia) e in Node (require) per i test. */
(function (radice, fabbrica) {
  const api = fabbrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else radice.Pizia = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DATA = '(\\d{1,4})[\\/.\\-](\\d{1,2})[\\/.\\-](\\d{1,4})';
  const ORA = '(\\d{1,2})[:.](\\d{2})(?:[:.](\\d{2}))?(?:\\s*([AaPp])\\.?\\s?[Mm]\\.?)?';
  // iOS:     [23/11/26, 07:23:10] Nome: testo
  // Android: 23/11/26, 07:23 - Nome: testo
  const RE_IOS = new RegExp('^\\[' + DATA + ',?\\s+' + ORA + '\\]\\s?([\\s\\S]*)$');
  const RE_ANDROID = new RegExp('^' + DATA + ',?\\s+' + ORA + '\\s+[-\\u2013]\\s([\\s\\S]*)$');

  const SEGNO = /^[‎‏]+/; // il segno invisibile che WhatsApp mette davanti alle righe speciali
  const RE_MEDIA = /omess|omitted|weggelaten|omitid|<allegato|<attached|<bijgevoegd|\(file allegato\)|\(file attached\)|\(bestand bijgevoegd\)|^posizione:|^location:|^locatie:|^sondaggio:|^poll:/i;
  const RE_ELIMINATO = /messaggio è stato eliminato|eliminato questo messaggio|message was deleted|deleted this message|bericht is verwijderd|dit bericht verwijderd/i;
  const RE_BLOCCO = /bloccato quest[oa] (contatto|persona)|blocked this (contact|person)|dit contact geblokkeerd/i;
  const RE_CHIAMATA = /chiamata|\bcall\b|oproep/i;
  // avvisi che WhatsApp scrive a nome di qualcuno ma che non sono messaggi
  const RE_AVVISO = /crittograf|end-to-end|encrypt|chiamata|\bcall\b|oproep|bloccato|blocked|codice di sicurezza|security code|effimer|disappearing|ha aggiunto|ha abbandonato|ha creato/i;
  const RE_SBLOCCO = /sbloccato|unblocked|gedeblokkeerd/i;
  const GIORNO_MS = 24 * 60 * 60 * 1000;

  function classifica(resto) {
    if (SEGNO.test(resto)) return { autore: null, testo: resto.replace(SEGNO, ''), tipo: 'sistema' };
    let taglio = resto.indexOf(': ');
    let testo;
    if (taglio < 0) {
      if (!resto.endsWith(':')) return { autore: null, testo: resto, tipo: 'sistema' };
      taglio = resto.length - 1;
      testo = '';
    } else {
      testo = resto.slice(taglio + 2);
    }
    const autore = resto.slice(0, taglio).replace(/^~\s*/, '').trim();
    const segnato = SEGNO.test(testo);
    const pulito = testo.replace(SEGNO, '');
    let tipo = 'testo';
    if (RE_ELIMINATO.test(pulito)) tipo = 'eliminato';
    else if (RE_MEDIA.test(pulito)) tipo = 'media';
    else if (segnato && RE_AVVISO.test(pulito)) tipo = 'sistema'; // avvisi di cifratura, chiamate perse, blocchi
    return { autore: autore, testo: pulito, tipo: tipo };
  }

  /** Legge il testo dell'export. Ritorna { formato, messaggi: [{timestamp, autore, testo, tipo}] }. */
  function leggi(testo) {
    if (testo.charCodeAt(0) === 0xfeff) testo = testo.slice(1);
    const righe = testo.split(/\r?\n/);
    const grezzi = [];
    let formato = null;
    let ultimo = null;
    for (let i = 0; i < righe.length; i++) {
      const riga = righe[i];
      const pulita = riga.replace(/[  ]/g, ' ').replace(SEGNO, '');
      let m = RE_IOS.exec(pulita);
      let f = 'ios';
      if (!m) { m = RE_ANDROID.exec(pulita); f = 'android'; }
      if (m) {
        if (!formato) formato = f;
        ultimo = classifica(m[8]);
        ultimo.d = [m[1], m[2], m[3]];
        ultimo.o = [+m[4], +m[5], +(m[6] || 0), m[7]];
        grezzi.push(ultimo);
      } else if (ultimo) {
        ultimo.testo += '\n' + riga; // riga senza data: continua il messaggio prima
      }
    }
    // giorno/mese o mese/giorno? Lo dice la chat stessa: un numero sopra 12 può essere solo un giorno.
    const annoPrima = grezzi.some(function (g) { return g.d[0].length === 4; });
    let giornoPrima = true;
    if (!annoPrima && !grezzi.some(function (g) { return +g.d[0] > 12; }) &&
        grezzi.some(function (g) { return +g.d[1] > 12; })) giornoPrima = false;

    const messaggi = grezzi.map(function (g) {
      let anno, mese, giorno;
      if (annoPrima) { anno = +g.d[0]; mese = +g.d[1]; giorno = +g.d[2]; }
      else {
        anno = +g.d[2];
        if (anno < 100) anno += 2000;
        if (giornoPrima) { giorno = +g.d[0]; mese = +g.d[1]; } else { mese = +g.d[0]; giorno = +g.d[1]; }
      }
      let ora = g.o[0];
      if (g.o[3]) {
        const pomeriggio = g.o[3].toLowerCase() === 'p';
        if (pomeriggio && ora < 12) ora += 12;
        if (!pomeriggio && ora === 12) ora = 0;
      }
      return {
        timestamp: new Date(anno, mese - 1, giorno, ora, g.o[1], g.o[2]),
        autore: g.autore,
        testo: g.testo.replace(/\n+$/, ''),
        tipo: g.tipo
      };
    });
    return { formato: formato, messaggi: messaggi };
  }

  function chiaveGiorno(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function mediana(lista) {
    if (!lista.length) return null;
    const o = lista.slice().sort(function (a, b) { return a - b; });
    const meta = o.length >> 1;
    return o.length % 2 ? o[meta] : (o[meta - 1] + o[meta]) / 2;
  }

  /** Calcola le statistiche. I tempi sono in millisecondi, le date in millisecondi dall'epoca. */
  function statistiche(lettura) {
    const perAutore = new Map();
    function scheda(nome) {
      if (!perAutore.has(nome)) perAutore.set(nome, { nome: nome, messaggi: 0, parole: 0, media: 0, eliminati: 0, tempi: [], apreGiornata: 0 });
      return perAutore.get(nome);
    }
    const ore = new Array(24).fill(0);
    const giorni = new Map();
    let sistema = 0, blocchi = 0, chiamate = 0, primo = null, ultimo = null, prima = null, giornoPrima = null;

    for (const m of lettura.messaggi) {
      if (m.tipo === 'sistema') {
        sistema++;
        if (RE_SBLOCCO.test(m.testo)) { /* sblocco: non si conta */ }
        else if (RE_BLOCCO.test(m.testo)) blocchi++;
        else if (RE_CHIAMATA.test(m.testo)) chiamate++;
        continue;
      }
      const s = scheda(m.autore);
      const t = m.timestamp.getTime();
      s.messaggi++;
      if (m.tipo === 'media') s.media++;
      else if (m.tipo === 'eliminato') s.eliminati++;
      else s.parole += m.testo.split(/\s+/).filter(Boolean).length;
      ore[m.timestamp.getHours()]++;

      const giorno = chiaveGiorno(m.timestamp);
      giorni.set(giorno, (giorni.get(giorno) || 0) + 1);
      if (giorno !== giornoPrima) { s.apreGiornata++; giornoPrima = giorno; }

      // risposta = cambio di autore; le pause oltre 24 ore non contano
      if (prima && prima.autore !== m.autore) {
        const attesa = t - prima.timestamp.getTime();
        if (attesa >= 0 && attesa <= GIORNO_MS) s.tempi.push(attesa);
      }
      if (!primo) primo = m;
      ultimo = m;
      prima = m;
    }

    const autori = Array.from(perAutore.values()).map(function (s) {
      const somma = s.tempi.reduce(function (a, b) { return a + b; }, 0);
      return {
        nome: s.nome, messaggi: s.messaggi, parole: s.parole, media: s.media, eliminati: s.eliminati,
        apreGiornata: s.apreGiornata, risposte: s.tempi.length,
        rispostaMediaMs: s.tempi.length ? somma / s.tempi.length : null,
        rispostaMedianaMs: mediana(s.tempi)
      };
    }).sort(function (a, b) { return b.messaggi - a.messaggi; });

    let giornoRecord = null;
    giorni.forEach(function (n, data) { if (!giornoRecord || n > giornoRecord.messaggi) giornoRecord = { data: data, messaggi: n }; });
    let oraPicco = 0;
    ore.forEach(function (n, h) { if (n > ore[oraPicco]) oraPicco = h; });

    return {
      formato: lettura.formato,
      totale: autori.reduce(function (a, s) { return a + s.messaggi; }, 0),
      sistema: sistema,
      autori: autori,
      primo: primo ? { quando: primo.timestamp.getTime(), autore: primo.autore, testo: primo.testo, tipo: primo.tipo } : null,
      ultimo: ultimo ? ultimo.timestamp.getTime() : null,
      giorniAttivi: giorni.size,
      giornoRecord: giornoRecord,
      ore: ore,
      oraPicco: oraPicco,
      blocchiTuoi: blocchi,
      chiamate: chiamate
    };
  }

  function analizza(testo) { return statistiche(leggi(testo)); }

  /** Trova il .txt dentro uno zip (quello che WhatsApp crea su iPhone) senza librerie. */
  async function txtDaZip(blob) {
    const coda = Math.min(blob.size, 65557);
    const fine = new DataView(await blob.slice(blob.size - coda).arrayBuffer());
    let p = -1;
    for (let i = fine.byteLength - 22; i >= 0; i--) {
      if (fine.getUint32(i, true) === 0x06054b50) { p = i; break; }
    }
    if (p < 0) throw new Error('Questo zip non si riesce a leggere.');
    const dimIndice = fine.getUint32(p + 12, true);
    const posIndice = fine.getUint32(p + 16, true);
    const indice = new DataView(await blob.slice(posIndice, posIndice + dimIndice).arrayBuffer());
    const voci = [];
    let q = 0;
    while (q + 46 <= indice.byteLength && indice.getUint32(q, true) === 0x02014b50) {
      const lungNome = indice.getUint16(q + 28, true);
      voci.push({
        metodo: indice.getUint16(q + 10, true),
        compresso: indice.getUint32(q + 20, true),
        posizione: indice.getUint32(q + 42, true),
        nome: new TextDecoder().decode(new Uint8Array(indice.buffer, q + 46, lungNome))
      });
      q += 46 + lungNome + indice.getUint16(q + 30, true) + indice.getUint16(q + 32, true);
    }
    const voce = voci.find(function (v) { return /_chat\.txt$/i.test(v.nome); }) ||
                 voci.find(function (v) { return /\.txt$/i.test(v.nome); });
    if (!voce) throw new Error('Nello zip non c\'è nessuna chat (.txt).');
    const testa = new DataView(await blob.slice(voce.posizione, voce.posizione + 30).arrayBuffer());
    const inizio = voce.posizione + 30 + testa.getUint16(26, true) + testa.getUint16(28, true);
    const dati = blob.slice(inizio, inizio + voce.compresso);
    if (voce.metodo === 0) return new Uint8Array(await dati.arrayBuffer());
    if (voce.metodo !== 8) throw new Error('Questo zip usa una compressione che non conosco.');
    const flusso = dati.stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(flusso).arrayBuffer());
  }

  /** Dal file scelto (txt o zip) al testo della chat. */
  async function testoDaFile(file) {
    const firma = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    const byte = (firma[0] === 0x50 && firma[1] === 0x4b) ? await txtDaZip(file) : new Uint8Array(await file.arrayBuffer());
    return new TextDecoder('utf-8').decode(byte);
  }

  /** 15120000 → «4 h 12 min» */
  function durata(ms) {
    if (ms == null) return '—';
    const s = Math.round(ms / 1000);
    if (s < 60) return s + ' s';
    const min = Math.round(s / 60);
    if (min < 60) return min + ' min';
    const h = Math.floor(min / 60);
    return h + ' h' + (min % 60 ? ' ' + (min % 60) + ' min' : '');
  }

  return { leggi: leggi, statistiche: statistiche, analizza: analizza, testoDaFile: testoDaFile, txtDaZip: txtDaZip, durata: durata };
});
