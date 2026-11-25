/* Deduko: English language file (UI strings and clue grammar). ES5. */
(function () {
  function cap(s) { return s.charAt(0).toUpperCase() + s.substring(1); }

  function subj(x) {
    if (x.suspect) return x.e.cap || cap(x.e.label);
    return cap(x.e.who);
  }

  function pred(ctx, x, neg) {
    if (x.suspect) return (neg ? 'was not ' : 'was ') + x.e.label;
    return ctx.pick(neg ? x.e.hasNot : x.e.has, 'm');
  }

  function noun(x) { return x.suspect ? x.e.label : x.e.who; }

  /* Words never left at the end of a shared head ("was in the" -> "was"). */
  var STOP = ['the', 'a', 'an', 'in', 'at', 'on', 'for', 'of', 'out', 'to', 'by', 'with'];

  DEDUKO.addLanguage({
    code: 'en',
    name: 'English',
    fields: {
      suspect: ['label', 'short'],
      item: ['short', 'has', 'hasNot', 'who'],
      ordered: ['less']
    },
    strings: {
      appTitle: 'Deduko',
      cases: 'Cases',
      newCase: 'New case',
      continueCase: 'Continue',
      language: 'Language',
      chooseLanguage: 'Choose a language',
      back: 'Back',
      menu: 'Menu',
      start: 'Start',
      resume: 'Resume',
      reset: 'Restart',
      resetConfirm: 'Sure?',
      story: 'The case',
      clues: 'Clues',
      prevPage: '< Prev',
      nextPage: 'Next >',
      pageOf: '{n}/{m}',
      statusNew: 'New',
      statusInProgress: 'In progress',
      statusSolved: 'Solved',
      solvedTitle: 'Case solved!',
      solvedMsg: 'Well done, detective: every piece is in its place.',
      wrongGrid: 'The grid is complete, but something does not add up.',
      generating: 'Preparing a new case...',
      generateFailed: 'Could not prepare the case. Please try again.',
      notAvailable: 'Only available in: {langs}',
      randomTitle: '{setting} #{n}',
      legend: 'X = no, dot = yes: pick a mark, then tap the cells; tap a mark again to erase it. Tap a clue to cross it out.',
      undo: 'Undo',
      codeButton: 'Code',
      enterCode: 'Enter a code',
      codeLabel: 'Code: {code}',
      codeInvalid: 'Invalid code.',
      codeVersion: 'This code is from an unknown version of Deduko.',
      keyDel: 'Del',
      keyOk: 'OK',
      modeTitle: 'Mode',
      modeFree: 'Free play',
      modeErrors: 'Max {m} errors',
      wrongMark: 'Wrong',
      errorCount: 'Errors: {n}/{m}',
      errorRestart: '{m} errors: the case starts over.',
      autoExclude: 'Auto',
      noCases: 'No cases available in this language.'
    },
    renderClue: function (clue, ctx) {
      var a = ctx.term(clue.a), b = ctx.term(clue.b), c, d, t, f, pc, pd;
      switch (clue.t) {
        case 'is':
        case 'not':
          if (!a.suspect && b.suspect) { t = a; a = b; b = t; }
          return subj(a) + ' ' + pred(ctx, b, clue.t === 'not') + '.';
        case 'or':
          c = ctx.term(clue.c);
          /* "Either Anna or Carla was in the garden." */
          if (b.suspect && c.suspect) return 'Either ' + b.e.label + ' or ' + c.e.label + ' ' + pred(ctx, a, false) + '.';
          pc = pred(ctx, b, false);
          pd = pred(ctx, c, false);
          f = ctx.factor(pc, pd, STOP);
          if (f) return subj(a) + ' ' + f.head + ' either ' + f.a + ' or ' + f.b + '.';
          return subj(a) + ' either ' + pc + ' or ' + pd + '.';
        case 'less':
          return subj(a) + ' ' + ctx.pick(ctx.category(clue.by).less, 'm') + ' ' + noun(b) + '.';
        case 'pair':
          c = ctx.term(clue.c);
          d = ctx.term(clue.d);
          pc = pred(ctx, c, false);
          pd = pred(ctx, d, false);
          f = ctx.factor(pc, pd, STOP);
          return 'Of ' + noun(a) + ' and ' + noun(b) + ', one ' + pc + ' and the other ' + (f ? f.b : pd) + '.';
      }
      return null;
    }
  });
})();
