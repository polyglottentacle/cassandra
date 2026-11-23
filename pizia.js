/* Pizia · il cuore: legge un export di WhatsApp e ne calcola le statistiche.
   Gira tutto sul dispositivo: nessuna chiamata di rete, nessuna libreria esterna.
   Si usa nel browser (window.Pizia) e in Node (require) per i test. */
(function (radice, fabbrica) {
  const api = fabbrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else radice.Pizia = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Lingue: l'italiano è la chiave. lingua(dizionario) cambia le frasi che escono; lingua(null) torna all'italiano.
  let DIZ = null;
  function lingua(dizionario) { DIZ = dizionario || null; }
  function T(it) {
    let s = (DIZ && DIZ[it]) || it;
    for (let i = 1; i < arguments.length; i++) s = s.split('{' + (i - 1) + '}').join(String(arguments[i]));
    return s;
  }
  function K(it) { return it; } // segna una frase che verrà tradotta più tardi

  const DATA ='(\\d{1,4})[\\/.\\-](\\d{1,2})[\\/.\\-](\\d{1,4})';
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
  const RE_AVVISO = /crittograf|end-to-end|encrypt|versleuteld|chiamata|\bcall\b|oproep|bloccato|blocked|geblokkeerd|codice di sicurezza|security code|beveiligingscode|effimer|disappearing|verdwijnende|ha aggiunto|ha abbandonato|ha creato|toegevoegd|verlaten|\badded\b|\bleft\b/i;
  const RE_SBLOCCO = /sbloccato|unblocked|gedeblokkeerd/i;
  const GIORNO_MS = 24 * 60 * 60 * 1000;
  const MEZZORA_MS = 30 * 60 * 1000;
  const RE_SCUSE = /(^|[^a-zà-ÿ])(scusa|scusami|perdonami|mi dispiace|perd[oó]n|perd[oó]name|lo siento|disculpa|sorry|sry|forgive me|het spijt me|spijt me|vergeef me|excuses)(?![a-zà-ÿ])/;
  const RE_AFFETTO = /(^|[^a-zà-ÿ])(ti amo|ti voglio bene|tvb|te amo|te quiero|tqm|love you|ik hou van je|ik hou van jou|hou van je|hou van jou)(?![a-zà-ÿ])/;
  const RE_EMOJI = /\p{Extended_Pictographic}/gu;
  const RE_PAROLA = /[a-zà-ÿ]{4,}/g;
  const RE_RISATA = /^(?:[jh]+[aeiou]+)+[jh]*$/;
  // parole che non dicono niente (italiano, spagnolo, inglese, olandese)
  const VUOTE = new Set(('sono anche come cosa però perché quando dove questo questa quello quella siamo hanno molto poco tutto tutti ancora allora quindi adesso dopo prima sempre solo così bene male fare fatto essere avere deve devo puoi posso vuoi voglio stai stavo della dello delle degli nella nelle alla alle agli dalla ecco ' +
    'para pero porque como cuando donde esta este esto estoy estas está estás eres tengo tienes tiene quiero quieres puedo puedes vamos hace hacer nada todo toda todos bien pues entonces ahora luego también tambien menos algo aquí aqui allí sólo vale claro bueno igual sisi nono okok ' +
    'that this with have what when where your just like dont about there they them then than from will would could should been were yeah okay ' +
    'voor niet maar deze heeft naar over door mijn jouw waar wanneer').split(' '));

  // Lessico corto e dichiarato per il tono: conta le parole, non capisce l'ironia.
  const RE_BELLO = /(^|[^a-zà-ÿ])(grazie|amore|bello|bella|bellissim[oa]|brav[oa]|felice|contento|contenta|mi manchi|ti amo|ti voglio bene|tesoro|perfetto|fantastico|stupendo|adoro|gracias|te quiero|te amo|hermos[oa]|lind[oa]|feliz|love|thanks|thank you|great|happy|beautiful|wonderful|miss you|dank je|dankjewel|bedankt|lief|mooi|prachtig|geweldig|blij|gelukkig|mis je|❤️|😍|🥰|😘|😊)(?![a-zà-ÿ])/;
  const RE_BRUTTO = /(^|[^a-zà-ÿ])(basta|stanc[oa]|odio|schifo|bugiard[oa]|stronz[oa]|vaffanculo|fanculo|lasciami|non mi scrivere|arrabbiat[oa]|delus[oa]|triste|piango|litigare|colpa tua|mentiros[oa]|mentira|te odio|d[eé]jame|harta|harto|enojad[oa]|hate|liar|leave me|angry|sad|shut up|moe van|haat|boos|verdrietig|leugenaar|laat me met rust|hou je mond|😡|🤬|😭|💔|😤)(?![a-zà-ÿ])/;
  const RE_LINK = /https?:\/\/([^\s\/]+)/g;

  // Temi (i «tag»): liste corte e dichiarate di parole in italiano, spagnolo, inglese e olandese.
  // Contano le parole, non capiscono il contesto: «amici» può parlare di altre persone.
  function parole(lista) { return new RegExp('(^|[^a-zà-ÿ])(' + lista + ')(?![a-zà-ÿ])'); }
  const TEMI = [
    { id: 'amore', nome: K('Ti amo'), colore: '#ff5d8f', re: parole('ti amo|te amo|i love you|love you|ik hou van je|ik hou van jou|hou van je|hou van jou|ti voglio bene|tvb|te quiero|tqm') },
    { id: 'nomignoli', nome: K('Nomignoli'), colore: '#ffb23f', re: parole('amore|amor|mi vida|vita mia|cariño|tesoro|bebé|bebe|baby|babe|honey|sweetheart|darling|schat|schatje|liefje|lieverd|cucciol[oa]|princes[as]|principessa') },
    { id: 'baci', nome: K('Baci'), colore: '#ff7b54', re: /(^|[^a-zà-ÿ])(baci[oa]?|bacion[ei]|bes[oa]s?|besit[oa]s?|kiss(es)?|kus(je|jes)?)(?![a-zà-ÿ])|😘|💋/ },
    { id: 'coppia', nome: K('Coppia'), colore: '#8f5bff', re: parole('fidanzat[oaie]|mio ragazzo|mia ragazza|novi[oa]|pareja|relazione|relaci[oó]n|stiamo insieme|estamos juntos|la mia donna|il mio uomo|mi mujer|mi hombre|moglie|marito|espos[oa]|boyfriend|girlfriend|relationship|husband|wife|verkering|relatie|mijn man|mijn vrouw') },
    { id: 'manchi', nome: K('Mi manchi'), colore: '#3fb6ff', re: parole('mi manchi|te extraño|te extrano|te echo de menos|i miss you|miss you|ik mis je|mis je|mis jou') },
    { id: 'promesse', nome: K('Promesse'), colore: '#22c9a5', re: parole('ti prometto|te prometo|prometto|te lo juro|te lo giuro|lo giuro|i promise|i swear|per sempre|para siempre|forever|ik beloof|beloofd|voor altijd') },
    { id: 'intimita', nome: K('Intimità'), colore: '#e0469b', re: parole('sesso|fare l.amore|hacer el amor|letto insieme|dormire insieme|dormir juntos|nud[oa]|desnud[oa]|sexy|naked|naakt|seks') },
    { id: 'gelosia', nome: K('Gelosia'), colore: '#9acd32', re: parole('gelos[oaie]|gelosia|celos[oa]?|celos|jealous|jealousy|jaloers') },
    { id: 'soloamici', nome: K('Solo amici'), colore: '#5c6b82', re: parole('solo amic[oi]|solo amig[oa]s|siamo amici|somos amigos|just friends|only friends|come amic[oi]|como amig[oa]s|restiamo amici|quedamos como amigos|gewoon vrienden|alleen vrienden') },
    { id: 'amici', nome: K('Amicizia'), colore: '#2f80ed', re: parole('amic[oaie]|amig[oa]s?|amicizia|amistad|friends?|friendship|vriend|vrienden|vriendin|vriendinnen|vriendschap') },
    { id: 'rottura', nome: K('Lasciarsi'), colore: '#e23b4e', re: parole('lasciamoci|ci lasciamo|ti lascio|terminamos|se acab[oó]|[eè] finita|abbiamo chiuso|non mi scrivere pi[uù]|no me escribas|addio|break up|breaking up|it.s over|we.re done|het is uit|het is voorbij|ik maak het uit') },
    { id: 'scuse', nome: K('Scuse'), colore: '#f2c94c', re: RE_SCUSE }
  ];

  /** Le frasi di un tema o con una parola scelta. Lavora sui messaggi in memoria: niente esce dal dispositivo. */
  function cerca(lettura, cosa) {
    let prova;
    if (cosa && cosa.tema) {
      const t = TEMI.find(function (x) { return x.id === cosa.tema; });
      if (!t) return [];
      prova = function (basso) { return t.re.test(basso); };
    } else if (cosa && cosa.parola && cosa.parola.trim().length >= 2) {
      const ago = cosa.parola.trim().toLowerCase();
      prova = function (basso) { return basso.indexOf(ago) >= 0; };
    } else return [];
    const out = [];
    for (const m of lettura.messaggi) {
      if (m.tipo !== 'testo') continue;
      if (cosa.autore && m.autore !== cosa.autore) continue;
      if (prova(m.testo.toLowerCase())) out.push({ quando: m.timestamp.getTime(), autore: m.autore, testo: m.testo });
    }
    return out;
  }

  // Il giudizio della giostra: un gioco con formula dichiarata, non una sentenza.
  const GRADINI = [
    K('Scappa subito e manda la posizione a un familiare'),
    K('Modalità aereo, respira e chiama un\'amica'),
    K('Più fumo che arrosto'),
    K('Né carne né pesce: parlatevi chiaro'),
    K('C\'è del buono: annaffiatelo'),
    K('Qui c\'è una cosa seria'),
    K('È la tua anima gemella')
  ];
  const CIMA = { Amicizia: [K('Un\'amicizia che tiene'), K('Amici per la vita')], Famiglia: [K('Una famiglia che c\'è'), K('Famiglia vera, tienitela stretta')], Lavoro: [K('Si lavora bene insieme'), K('Collega d\'oro')] };
  function verdetto(st, etichetta) {
    const voci = [];
    function voce(nome, punti) { punti = Math.round(punti); if (punti) voci.push({ nome: T(nome), punti: punti }); return punti; }
    const base = Math.round(50 + ((st.equilibrio == null ? 50 : st.equilibrio) - 50) * 0.5);
    let p = base;
    const tema = function (id) { const t = (st.temi || []).find(function (x) { return x.id === id; }); return t ? t.totale : 0; };
    const perMille = function (n) { return st.totale ? n / st.totale * 1000 : 0; };
    p += voce(K('Parole d\'amore'), Math.min(12, perMille(tema('amore')) * 2));
    if (st.striscia >= 30) p += voce(K('Vi scrivete ogni giorno'), 6);
    const belli = (st.mesi || []).reduce(function (a, m) { return a + m.belli; }, 0);
    const brutti = (st.mesi || []).reduce(function (a, m) { return a + m.brutti; }, 0);
    if (belli + brutti >= 20) p += voce(K('Tono delle parole'), (belli / (belli + brutti) - 0.5) * 30);
    const ss = segnali(st);
    p += voce(K('Buoni segni'), 3 * ss.filter(function (s) { return s.tono === 'buono'; }).length);
    p += voce(K('Cose da guardare'), -6 * ss.filter(function (s) { return s.tono === 'attenzione'; }).length);
    p += voce(K('Blocchi'), -Math.min(15, 2 * (st.blocchiTuoi || 0)));
    p += voce(K('Silenzi lunghi'), -Math.min(10, 3 * (st.silenzi || 0)));
    p += voce(K('Parole di rottura'), -Math.min(10, perMille(tema('rottura')) * 3));
    p = Math.max(0, Math.min(100, Math.round(p)));
    const gradino = Math.min(6, Math.floor(p / 15));
    let titolo = GRADINI[gradino];
    if (CIMA[etichetta] && gradino >= 5) titolo = CIMA[etichetta][gradino - 5];
    return { punti: p, gradino: gradino, titolo: T(titolo), base: base, voci: voci };
  }

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
      if (!perAutore.has(nome)) perAutore.set(nome, { nome: nome, messaggi: 0, parole: 0, media: 0, eliminati: 0, tempi: [], apreGiornata: 0,
        emoji: new Map(), paroleUsate: new Map(), notte: 0, insistenze: 0, scuse: 0, affetto: 0, link: 0, temi: {} });
      return perAutore.get(nome);
    }
    const ore = new Array(24).fill(0);
    const giorni = new Map();
    const mesi = new Map(), siti = new Map();
    const settimana = Array.from({ length: 7 }, function () { return new Array(24).fill(0); });
    let silenzi = 0, silenzioMax = { ms: 0, rotto: null }, striscia = 0, strisciaOra = 0, numGiornoPrima = null, notte = 0;
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
      const chiaveMese = m.timestamp.getFullYear() + '-' + String(m.timestamp.getMonth() + 1).padStart(2, '0');
      if (!mesi.has(chiaveMese)) mesi.set(chiaveMese, { mese: chiaveMese, totale: 0, belli: 0, brutti: 0, perAutore: {} });
      const mm = mesi.get(chiaveMese);
      mm.totale++;
      mm.perAutore[m.autore] = (mm.perAutore[m.autore] || 0) + 1;
      settimana[(m.timestamp.getDay() + 6) % 7][m.timestamp.getHours()]++;
      if (m.tipo === 'media') s.media++;
      else if (m.tipo === 'eliminato') s.eliminati++;
      else {
        s.parole += m.testo.split(/\s+/).filter(Boolean).length;
        const basso = m.testo.toLowerCase();
        const faccine = m.testo.match(RE_EMOJI);
        if (faccine) for (const f of faccine) s.emoji.set(f, (s.emoji.get(f) || 0) + 1);
        if (basso.indexOf('http') < 0) {
          const pp = basso.match(RE_PAROLA);
          if (pp) for (const p of pp) if (!VUOTE.has(p) && !RE_RISATA.test(p)) s.paroleUsate.set(p, (s.paroleUsate.get(p) || 0) + 1);
        }
        for (const tm of TEMI) if (tm.re.test(basso)) s.temi[tm.id] = (s.temi[tm.id] || 0) + 1;
        if (RE_BELLO.test(basso)) mm.belli++;
        if (RE_BRUTTO.test(basso)) mm.brutti++;
        let lk; RE_LINK.lastIndex = 0;
        while ((lk = RE_LINK.exec(basso))) { s.link++; const sito = lk[1].replace(/^www\./, ''); siti.set(sito, (siti.get(sito) || 0) + 1); }
        if (RE_SCUSE.test(basso)) s.scuse++;
        if (RE_AFFETTO.test(basso)) s.affetto++;
      }
      const oraDelGiorno = m.timestamp.getHours();
      if (oraDelGiorno < 5) { s.notte++; notte++; }
      ore[oraDelGiorno]++;

      const giorno = chiaveGiorno(m.timestamp);
      giorni.set(giorno, (giorni.get(giorno) || 0) + 1);
      if (giorno !== giornoPrima) {
        s.apreGiornata++;
        giornoPrima = giorno;
        const numGiorno = Math.round(Date.UTC(m.timestamp.getFullYear(), m.timestamp.getMonth(), m.timestamp.getDate()) / GIORNO_MS);
        strisciaOra = (numGiornoPrima != null && numGiorno === numGiornoPrima + 1) ? strisciaOra + 1 : 1;
        if (strisciaOra > striscia) striscia = strisciaOra;
        numGiornoPrima = numGiorno;
      }

      if (prima) {
        const attesa = t - prima.timestamp.getTime();
        if (prima.autore !== m.autore) {
          // risposta = cambio di autore; le pause oltre 24 ore non contano
          if (attesa >= 0 && attesa <= GIORNO_MS) s.tempi.push(attesa);
        } else if (attesa >= MEZZORA_MS && attesa <= GIORNO_MS) {
          s.insistenze++; // ha riscritto dopo almeno mezz'ora senza aver avuto risposta
        }
        if (attesa > 3 * GIORNO_MS) {
          silenzi++;
          if (attesa > silenzioMax.ms) silenzioMax = { ms: attesa, rotto: m.autore };
        }
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
        notte: s.notte, insistenze: s.insistenze, scuse: s.scuse, affetto: s.affetto, link: s.link,
        emojiTop: primi(s.emoji, 6), paroleTop: primi(s.paroleUsate, 8),
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
      chiamate: chiamate,
      notte: notte,
      striscia: striscia,
      silenzi: silenzi,
      silenzioMax: silenzioMax.ms ? silenzioMax : null,
      mesi: Array.from(mesi.values()).sort(function (a, b) { return a.mese < b.mese ? -1 : 1; }),
      settimana: settimana,
      sitiTop: primi(siti, 5),
      temi: TEMI.map(function (tm) {
        const per = {};
        let tot = 0;
        perAutore.forEach(function (s) { const n = s.temi[tm.id] || 0; per[s.nome] = n; tot += n; });
        return { id: tm.id, nome: tm.nome, colore: tm.colore, totale: tot, perAutore: per };
      }),
      equilibrio: equilibrio(autori, giorni.size)
    };
  }

  // Indice di equilibrio 0-100, solo per chat a due. Formula dichiarata:
  // media di tre somiglianze (messaggi, chi apre la giornata, velocità di risposta).
  // Non misura l'amore: misura quanto lo sforzo è diviso in parti uguali.
  function equilibrio(autori, giorniAttivi) {
    if (autori.length !== 2) return null;
    const a = autori[0], b = autori[1];
    function somiglia(x, y) { const M = Math.max(x, y); return M > 0 ? Math.min(x, y) / M : 1; }
    const parti = [somiglia(a.messaggi, b.messaggi), somiglia(a.apreGiornata, b.apreGiornata)];
    if (a.rispostaMedianaMs != null && b.rispostaMedianaMs != null) parti.push(somiglia(a.rispostaMedianaMs + 60000, b.rispostaMedianaMs + 60000));
    return Math.round(100 * parti.reduce(function (x, y) { return x + y; }, 0) / parti.length);
  }

  function primi(mappa, quanti) {
    return Array.from(mappa.entries()).sort(function (a, b) { return b[1] - a[1]; }).slice(0, quanti);
  }
  function perc(x) { return Math.round(x * 100) + '%'; }

  /** I segnali: regole semplici e dichiarate sui numeri. Sono conti, non giudizi. Solo per chat a due. */
  function segnali(st) {
    const out = [];
    if (!st || st.autori.length !== 2 || !st.totale) return out;
    const a = st.autori[0], b = st.autori[1];
    function metti(tono, titolo, testo) { out.push({ tono: tono, titolo: titolo, testo: testo }); }

    const quota = a.messaggi / st.totale;
    if (quota > 0.6) metti('attenzione', T('{0} scrive molto di più', a.nome), T('{0} dei messaggi sono suoi.', perc(quota)));
    else if (quota <= 0.55) metti('buono', T('Scrivete quasi uguale'), T('{0} e {1}: nessuno dei due parla da solo.', perc(quota), perc(1 - quota)));

    if (a.rispostaMedianaMs != null && b.rispostaMedianaMs != null) {
      const lento = a.rispostaMedianaMs >= b.rispostaMedianaMs ? a : b;
      const svelto = lento === a ? b : a;
      if (lento.rispostaMedianaMs <= 5 * 60000) metti('buono', T('Vi rispondete in fretta'), T('Di solito {0} risponde in {1} e {2} in {3}.', svelto.nome, durata(svelto.rispostaMedianaMs), lento.nome, durata(lento.rispostaMedianaMs)));
      else if (lento.rispostaMedianaMs >= MEZZORA_MS && lento.rispostaMedianaMs >= 5 * svelto.rispostaMedianaMs) metti('attenzione', T('{0} fa aspettare', lento.nome), T('Di solito risponde in {0}, contro {1} di {2}.', durata(lento.rispostaMedianaMs), durata(svelto.rispostaMedianaMs), svelto.nome));
    }

    const apre = a.apreGiornata >= b.apreGiornata ? a : b;
    const quotaApre = apre.apreGiornata / Math.max(1, st.giorniAttivi);
    if (quotaApre > 0.7) metti('attenzione', T('È quasi sempre {0} a cercare', apre.nome), T('Apre la giornata {0} delle volte.', perc(quotaApre)));

    if (a.insistenze != null) {
      const insiste = a.insistenze >= b.insistenze ? a : b;
      const altro = insiste === a ? b : a;
      if (insiste.insistenze >= 20 && insiste.insistenze >= 2 * altro.insistenze) metti('attenzione', T('{0} riscrive spesso senza risposta', insiste.nome), T('{0} volte ha riscritto dopo almeno mezz\'ora di silenzio, contro {1} di {2}.', insiste.insistenze, altro.insistenze, altro.nome));

      [a, b].forEach(function (x) {
        if (x.eliminati >= 20 && x.eliminati / x.messaggi > 0.03) metti('nota', T('{0} cancella molti messaggi', x.nome), T('{0} messaggi eliminati ({1} dei suoi).', x.eliminati, perc(x.eliminati / x.messaggi)));
      });

      const chiede = a.scuse >= b.scuse ? a : b;
      const altroScuse = chiede === a ? b : a;
      if (chiede.scuse >= 10 && chiede.scuse >= 3 * altroScuse.scuse) metti('nota', T('È quasi sempre {0} a chiedere scusa', chiede.nome), T('{0} messaggi di scuse, contro {1}.', chiede.scuse, altroScuse.scuse));
      if (a.affetto > 0 && b.affetto > 0) metti('buono', T('Ve lo dite tutti e due'), T('{0} {1} volte, {2} {3} volte (ti amo, te quiero, ti voglio bene…).', a.nome, a.affetto, b.nome, b.affetto));
      else if (a.affetto + b.affetto >= 10) metti('nota', T('Lo dice solo {0}', a.affetto ? a.nome : b.nome), T('{0} volte, l\'altra persona mai (con queste parole).', a.affetto || b.affetto));
    }

    if (st.blocchiTuoi > 0) metti('attenzione', st.blocchiTuoi === 1 ? T('Hai bloccato questa chat {0} volta', 1) : T('Hai bloccato questa chat {0} volte', st.blocchiTuoi), T('Il file segna solo i blocchi fatti da chi esporta.'));
    if (st.silenzioMax) metti('nota', st.silenzi === 1 ? T('{0} silenzio di oltre 3 giorni', 1) : T('{0} silenzi di oltre 3 giorni', st.silenzi), T('Il più lungo è durato {0} giorni. L\'ha rotto {1}.', Math.round(st.silenzioMax.ms / GIORNO_MS), st.silenzioMax.rotto));
    if (st.notte != null && st.notte / st.totale > 0.15) metti('nota', T('Vi scrivete molto di notte'), T('{0} dei messaggi sono tra mezzanotte e le 5.', perc(st.notte / st.totale)));
    if (st.striscia >= 30) metti('buono', T('{0} giorni di fila', st.striscia), T('La striscia più lunga senza saltare un giorno.'));
    return out;
  }

  /** Un riassunto di soli numeri (niente nomi, niente messaggi) da incollare nella propria IA. */
  function riassunto(st) {
    const sigle = ['A', 'B', 'C', 'D', 'E', 'F'];
    const sigla = {};
    st.autori.slice(0, 6).forEach(function (x, i) { sigla[x.nome] = T('Persona {0}', sigle[i]); });
    function anonimo(t) { Object.keys(sigla).forEach(function (n) { t = t.split(n).join(sigla[n]); }); return t; }
    const righe = [
      T('Qui sotto ci sono solo i numeri di una chat di WhatsApp (nessun messaggio, nessun nome). Io sono la Persona ___.'),
      T('Dimmi con onestà e gentilezza: cosa va bene, cosa terresti d\'occhio, e tre domande che dovrei farmi. Non inventare fatti che i numeri non mostrano.'),
      '',
      T('Messaggi totali: {0} in {1} giorni attivi. Striscia più lunga: {2} giorni. Chiamate: {3}.', st.totale, st.giorniAttivi, st.striscia || '?', st.chiamate || 0)
    ];
    if (st.equilibrio != null) righe.push(T('Indice di equilibrio dello sforzo: {0} su 100.', st.equilibrio));
    if (st.mesi && st.mesi.length) righe.push(T('Messaggi per mese (mese: totale, parole belle/tese): {0}.', st.mesi.map(function (m) { return m.mese + ': ' + m.totale + ', ' + m.belli + '/' + m.brutti; }).join('; ')));
    st.autori.slice(0, 6).forEach(function (x) {
      righe.push(sigla[x.nome] + ': ' + T('{0} messaggi; risponde in media in {1} (di solito {2}); apre la giornata {3} volte; riscrive senza risposta {4} volte; messaggi eliminati {5}; di notte {6}; scuse {7}; parole d\'affetto {8}.', x.messaggi, durata(x.rispostaMediaMs), durata(x.rispostaMedianaMs), x.apreGiornata, x.insistenze || 0, x.eliminati, x.notte || 0, x.scuse || 0, x.affetto || 0));
    });
    const ss = segnali(st);
    if (ss.length) {
      righe.push('', T('Segnali calcolati:'));
      ss.forEach(function (s) { righe.push('- ' + anonimo(s.titolo) + '. ' + anonimo(s.testo)); });
    }
    return righe.join('\n');
  }

  function analizza(testo) { return statistiche(leggi(testo)); }

  /** Trova il .txt dentro uno zip (quello che WhatsApp crea su iPhone) senza librerie. */
  async function txtDaZip(blob) {
    const voci = await vociZip(blob);
    const voce = voci.find(function (v) { return /_chat\.txt$/i.test(v.nome); }) ||
                 voci.find(function (v) { return /\.txt$/i.test(v.nome); });
    if (!voce) throw new Error(T('Nello zip non c\'è nessuna chat (.txt).'));
    return estraiVoce(blob, voce);
  }

  /** Foto, video e audio dentro lo zip (se la chat è stata esportata «con media»). Restano sul dispositivo. */
  async function mediaDaZip(blob, quante) {
    const firma = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    const vuoto = { foto: 0, video: 0, audio: 0, anteprime: [] };
    if (!(firma[0] === 0x50 && firma[1] === 0x4b)) return vuoto;
    const voci = await vociZip(blob);
    const foto = voci.filter(function (v) { return /\.(jpe?g|png|webp|gif)$/i.test(v.nome); });
    const out = {
      foto: foto.length,
      video: voci.filter(function (v) { return /\.(mp4|mov|3gp|m4v)$/i.test(v.nome); }).length,
      audio: voci.filter(function (v) { return /\.(opus|ogg|m4a|mp3|aac)$/i.test(v.nome); }).length,
      anteprime: []
    };
    for (const v of foto.slice(-(quante || 12))) {
      const est = v.nome.split('.').pop().toLowerCase();
      const tipo = est === 'png' ? 'image/png' : est === 'webp' ? 'image/webp' : est === 'gif' ? 'image/gif' : 'image/jpeg';
      try { out.anteprime.push(new Blob([await estraiVoce(blob, v)], { type: tipo })); } catch (e) { /* una foto rotta non ferma le altre */ }
    }
    return out;
  }

  async function estraiVoce(blob, voce) {
    const testa = new DataView(await blob.slice(voce.posizione, voce.posizione + 30).arrayBuffer());
    const inizio = voce.posizione + 30 + testa.getUint16(26, true) + testa.getUint16(28, true);
    const dati = blob.slice(inizio, inizio + voce.compresso);
    if (voce.metodo === 0) return new Uint8Array(await dati.arrayBuffer());
    if (voce.metodo !== 8) throw new Error(T('Questo zip usa una compressione che non conosco.'));
    if (typeof DecompressionStream === 'undefined') throw new Error(T('Questo telefono non riesce ad aprire lo zip. Aggiorna il browser oppure carica il file .txt.'));
    const flusso = dati.stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(flusso).arrayBuffer());
  }

  async function vociZip(blob) {
    const coda = Math.min(blob.size, 65557);
    const fine = new DataView(await blob.slice(blob.size - coda).arrayBuffer());
    let p = -1;
    for (let i = fine.byteLength - 22; i >= 0; i--) {
      if (fine.getUint32(i, true) === 0x06054b50) { p = i; break; }
    }
    if (p < 0) throw new Error(T('Questo zip non si riesce a leggere.'));
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
    return voci;
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

  return { t: T, lingua: lingua, cerca: cerca, verdetto: verdetto, segnali: segnali, riassunto: riassunto, leggi: leggi, statistiche: statistiche, analizza: analizza, testoDaFile: testoDaFile, txtDaZip: txtDaZip, mediaDaZip: mediaDaZip, durata: durata };
});
