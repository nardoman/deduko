/* Deduko: Italian language file (UI strings and clue grammar). ES5. */
(function () {
  function cap(s) { return s.charAt(0).toUpperCase() + s.substring(1); }

  /* Subject at sentence start, with the gender used for agreement. */
  function subj(x) {
    if (x.suspect) return { text: x.e.cap || cap(x.e.label), g: x.g };
    return { text: cap(x.e.who), g: 'm' };
  }

  function pred(ctx, x, g, neg) {
    if (x.suspect) return (neg ? 'non era ' : 'era ') + x.e.label;
    return ctx.pick(neg ? x.e.hasNot : x.e.has, g);
  }

  function noun(x) { return x.suspect ? x.e.label : x.e.who; }

  /* " e " or " ed " before a word starting with e ("Anna ed Elena"). */
  function and(next) { return /^[eEéÉèÈ]/.test(next) ? ' ed ' : ' e '; }

  function diForm(x) { return x.suspect ? (x.e.di || 'di ' + x.e.label) : 'di ' + x.e.who; }

  /* Words never left at the end of a shared head ("era in" -> "era"). */
  var STOP = ['a', 'al', 'allo', 'alla', 'alle', 'ai', 'agli', 'il', 'lo', 'la', 'i', 'gli', 'le', "l'",
    'un', 'uno', 'una', 'di', 'del', 'dello', 'della', 'dei', 'degli', 'delle', 'in', 'nel', 'nello',
    'nella', 'nei', 'negli', 'nelle', 'per', 'con', 'da', 'dal', 'dalla'];

  /* Plural of a shared head ("aveva" -> "avevano", "è arrivato" ->
     "sono arrivati"/"sono arrivate"), or null when it has none. */
  function plural(h, g) {
    var w = h.split(' '), p;
    if (w.length === 1 && /a$/.test(h)) return h + 'no';
    if (w.length === 2 && w[0] === 'è' && /[oa]$/.test(w[1])) {
      p = w[1].substring(0, w[1].length - 1);
      return 'sono ' + p + (g === 'f' ? 'e' : 'i');
    }
    return null;
  }

  DEDUKO.addLanguage({
    code: 'it',
    name: 'Italiano',
    fields: {
      suspect: ['label', 'short', 'g'],
      item: ['short', 'has', 'hasNot', 'who'],
      ordered: ['less']
    },
    strings: {
      appTitle: 'Deduko',
      cases: 'Casi',
      newCase: 'Nuovo caso',
      continueCase: 'Continua',
      language: 'Lingua',
      chooseLanguage: 'Scegli la lingua',
      back: 'Indietro',
      menu: 'Menu',
      start: 'Inizia',
      resume: 'Riprendi',
      reset: 'Ricomincia',
      resetConfirm: 'Sicuro?',
      story: 'Il caso',
      clues: 'Indizi',
      prevPage: '< Prec.',
      nextPage: 'Succ. >',
      pageOf: '{n}/{m}',
      statusNew: 'Nuovo',
      statusInProgress: 'In corso',
      statusSolved: 'Risolto',
      solvedTitle: 'Caso risolto!',
      solvedMsg: 'Ottimo lavoro, detective: ogni tassello è al suo posto.',
      wrongGrid: 'La griglia è completa, ma qualcosa non torna.',
      generating: 'Preparo un nuovo caso...',
      generateFailed: 'Non sono riuscito a preparare il caso. Riprova.',
      notAvailable: 'Disponibile solo in: {langs}',
      randomTitle: '{setting} n. {n}',
      legend: 'X = no, pallino = sì: scegli il segno e tocca le caselle; tocca di nuovo un segno per cancellarlo. Tocca un indizio per barrarlo.',
      undo: 'Annulla',
      codeButton: 'Codice',
      enterCode: 'Inserisci il codice',
      codeLabel: 'Codice: {code}',
      codeInvalid: 'Codice non valido.',
      codeVersion: 'Codice di una versione di Deduko sconosciuta.',
      keyDel: 'Canc',
      keyOk: 'OK',
      modeTitle: 'Modalità',
      modeFree: 'Libera',
      modeErrors: 'Max {m} errori',
      wrongMark: 'Sbagliato',
      errorCount: 'Errori: {n}/{m}',
      errorRestart: '{m} errori: il caso ricomincia da capo.',
      autoExclude: 'Auto',
      noCases: 'Nessun caso disponibile in questa lingua.'
    },
    renderClue: function (clue, ctx) {
      var a = ctx.term(clue.a), b = ctx.term(clue.b), c, d, s, t, fem, g, f, pc, pd, pl;
      switch (clue.t) {
        case 'is':
        case 'not':
          if (!a.suspect && b.suspect) { t = a; a = b; b = t; }
          s = subj(a);
          return s.text + ' ' + pred(ctx, b, s.g, clue.t === 'not') + '.';
        case 'or':
          c = ctx.term(clue.c);
          if (b.suspect && c.suspect) {
            /* "In giardino c'era Anna o Carla." */
            if (typeof a.e.lead === 'string' && a.e.lead) return a.e.lead + ' ' + b.e.label + ' o ' + c.e.label + '.';
            return subj(a).text + ' era ' + b.e.label + ' o ' + c.e.label + '.';
          }
          s = subj(a);
          pc = pred(ctx, b, s.g, false);
          pd = pred(ctx, c, s.g, false);
          f = ctx.factor(pc, pd, STOP);
          if (f) return s.text + ' ' + f.head + ' ' + f.a + ' o ' + f.b + '.';
          return s.text + ' ' + pc + ' o ' + pd + '.';
        case 'less':
          s = subj(a);
          return s.text + ' ' + ctx.pick(ctx.category(clue.by).less, s.g) + ' ' + diForm(b) + '.';
        case 'pair':
          c = ctx.term(clue.c);
          d = ctx.term(clue.d);
          /* "una ... l'altra" when the two people referred to are both female
             suspects, whether they are named in the first pair or the second */
          fem = (a.suspect && b.suspect && a.g === 'f' && b.g === 'f') ||
            (c.suspect && d.suspect && c.g === 'f' && d.g === 'f');
          g = fem ? 'f' : 'm';
          if (c.suspect && d.suspect) {
            /* People first: "Anna e Dario erano uno in giardino e l'altro nello studio." */
            pc = pred(ctx, a, g, false);
            pd = pred(ctx, b, g, false);
            f = ctx.factor(pc, pd, STOP);
            pl = f ? plural(f.head, g) : null;
            if (pl) {
              return cap(c.e.label) + and(d.e.label) + d.e.label + ' ' + pl + ' ' + (fem ? 'una ' : 'uno ') + f.a +
                ' e ' + (fem ? "l'altra " : "l'altro ") + f.b + '.';
            }
            return 'Tra ' + c.e.label + and(d.e.label) + d.e.label + ', ' + (fem ? 'una ' : 'uno ') + pc +
              ' e ' + (fem ? "l'altra " : "l'altro ") + pd + '.';
          }
          pc = pred(ctx, c, g, false);
          pd = pred(ctx, d, g, false);
          f = ctx.factor(pc, pd, STOP);
          pl = f && !c.suspect ? plural(f.head, g) : null;
          /* "Anna e Carla sono arrivate una alle 20:00 e l'altra alle 21:00." */
          if (pl) {
            return cap(noun(a)) + and(noun(b)) + noun(b) + ' ' + pl + ' ' + (fem ? 'una ' : 'uno ') + f.a +
              ' e ' + (fem ? "l'altra " : "l'altro ") + f.b + '.';
          }
          return 'Tra ' + noun(a) + and(noun(b)) + noun(b) + ', ' + (fem ? 'una ' : 'uno ') + pc +
            ' e ' + (fem ? "l'altra " : "l'altro ") + (f ? f.b : pd) + '.';
      }
      return null;
    }
  });
})();
