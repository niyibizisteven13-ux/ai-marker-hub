/**
 * Does this message ask the chat to look something up or do something on the platform (a live room, a class, marks, a quiz, results)?
 * Such turns get the tools (and the agent model); everyday questions stay on the cheaper chat model. English, French and Kinyarwanda.
 * It errs towards giving the tools: a missed request is worse than one tool turn that was not needed.
 */
// Terms that only mean the platform: enough on their own.
const STRONG = /(?<![\p{L}])(morning brief|daily brief|every (?:morning|day|week|monday|tuesday|wednesday|thursday|friday)|each (?:morning|day|week)|remind me|schedule (?:a |my |this )?(?:task|brief|report)|what needs me|my agenda|pending payments?|payment requests?|approve (?:the |his |her |their )?payment|room assistant|debrief|launch (?:my |the |a )?(?:test|exam|quiz)|run (?:my |the |a )?(?:test|exam|quiz)|start (?:my |the |a )?(?:test|exam|quiz)|my ?seb|live[- ]?room|live exam|gradebook|grade[- ]?book|roster|disqualif\w*|join link|link for students|code for students|student card|browser mode|saved answers|practice class(?:es)?|join code|class code|kuri live|ibyemezo by'abanyeshuri|salle en direct|liste de classe|carnet de notes(?![\p{L}]))|(?<![\p{L}])let [\w'.-]+(?: [\w'.-]+)? back in(?![\p{L}])/iu;
// Things the platform holds.
const NOUN = /(?<![\p{L}])(exams?|tests?|quiz(?:zes)?|class(?:es)?|courses?|students?|learners?|pupils?|marks?|marking|grades?|results?|scores?|forms?|surveys?|questionnaires?|tasks?|assignments?|homework|submissions?|scripts?|papers?|candidates?|examen|examens|classe|classes|[ée]tudiants?|[ée]l[èe]ves?|notes?|r[ée]sultats?|ikizamini|ibizamini|abanyeshuri|umunyeshuri|ishuri|amanota|ibisubizo|umukoro|imikoro(?![\p{L}]))/iu;
// Asking about it or doing something with it (not just talking about the subject in general).
const CONTEXT = /(?<![\p{L}])(my|our|the|this|that|these|those|mine|mon|ma|mes|notre|nos|ce|cette|ces|wanjye|banjye|bwanjye(?![\p{L}]))[^.?!]{0,40}(?<![\p{L}])(exams?|tests?|quiz(?:zes)?|class(?:es)?|courses?|students?|learners?|marks?|results?|forms?|surveys?|tasks?|scripts?|papers?|candidates?|examen|classe|[ée]tudiants?|[ée]l[èe]ves?|notes?|r[ée]sultats?|ikizamini|abanyeshuri|ishuri|amanota(?![\p{L}]))|(?<![\p{L}])(who|how many|which|list|show|open|close|end|stop|pause|resume|release|publish|mark|grade|export|download|create|make|set ?up|start|generate|give me a code|get (?:me )?a code|add|remove|link|let (?:him|her|them) back|reinstate|qui|combien|liste|montre|ouvre|ferme|publie|corrige|exporte|cr[ée]e|fais|ajoute|nde|ni bangahe|erekana|fungura|funga|tangaza|kosora|shyiraho|kora(?![\p{L}]))/iu;
// "Explain what a quiz is" style questions about the subject itself are not platform requests.
const GENERAL = /^\s*(what is|what are|what's|define|explain|why do|why is|how does|how do (?:i|you) (?:study|prepare|revise)|tips? for|advice (?:on|for)|qu['’]est-ce qu(?:e|['’])|c['’]est quoi|ni iki(?![\p{L}]))/iu;

// The owner's own business (bwenge4biz): recording sales and expenses, stock, orders, the page and feed, payment requests. English, French, Kinyarwanda.
const BIZ = /(?<![\p{L}])(my (?:business|shop|store|boutique|stall|restaurant|salon|farm|dashboard)|business (?:page|dashboard|agent|feed|notebook)|bwenge4biz|(?:today |yesterday )?(?:i|we) (?:sold|made|spent|bought|paid for|earned)|sold \d|(?:record|add|log|enter) (?:an? |my |the |some )?(?:sale|sales|expense|expenses)|(?:how (?:much|is|are|was|were)|what(?:'s| is| are)) [^.?!]{0,30}(?:my|our|today'?s?) [^.?!]{0,25}(?:sales|business|profit|expenses|stock|orders)|(?:low|running out of|out of) stock|restock|(?:pending|new|customer) orders?|post (?:an? )?(?:update|photo|picture|offer|promotion) (?:on|to) (?:my |the )?(?:page|feed)|(?:ask|request) [\w .+-]{2,40} (?:to pay|for payment)|payment request (?:to|for)|publish my (?:page|shop|business)|close (?:the |my )?day|open (?:the |my )?(?:shop|day)|nacuruje|nagurishije|natanze|natumije|ubucuruzi bwanjye|iduka ryanjye|ibicuruzwa byanjye|j['’]ai (?:vendu|dépensé|acheté)|mon (?:commerce|entreprise)|ma boutique|mes ventes)/iu;

export function needsPlatformTools(message: string): boolean {
  const text = message.trim();
  if (text.length < 6) return false;
  if (STRONG.test(text) || BIZ.test(text)) return true;
  if (GENERAL.test(text) && !/\b(my|our|mine|mon|ma|mes|wanjye)\b/i.test(text)) return false;
  return NOUN.test(text) && CONTEXT.test(text);
}
