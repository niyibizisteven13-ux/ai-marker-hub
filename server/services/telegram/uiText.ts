import type { Lang } from './ui.js';

/**
 * Every user-facing string of the Telegram bot, in English, Kinyarwanda and French.
 * Kinyarwanda and French were written for this release; have a native speaker review them.
 */

interface Guide { icon: string; title: string; body: string; examples: string[] }
interface Copy {
  hello: string; helloName: (n: string) => string; intro: string; whatICanDo: string; capabilities: Array<[string, string]>; homeFooter: string;
  tryAsking: string; working: string; settings: string; language: string; langName: string; account: string; notLinked: string; linkHint: string;
  myFiles: string; noFiles: string; filesFooter: (p: number, n: number) => string;
  errorTitle: string; errorBody: string; errorFooter: string;
  fileTooLarge: string; unsupportedMessage: string; slowDown: string; fileMissing: string; nothingToRegenerate: string; languageSet: string;
  receivedFile: (n: string) => string; readyCaption: string;
  scan: { title: string; body: string; steps: string[]; footer: string; open: string; groupHint: string; received: (pages: string) => string };
  profile: { description: string; short: string; menuButton: string };
  ago: { now: string; min: (n: number) => string; hour: (n: number) => string };
  buttons: Record<'create' | 'mark' | 'scan' | 'transcribe' | 'library' | 'files' | 'settings' | 'help' | 'back' | 'regenerate' | 'menu' | 'retry', string>;
  guides: Record<'create' | 'mark' | 'transcribe' | 'library' | 'help', Guide>;
  commands: Array<{ command: string; description: string }>;
}

const en: Copy = {
  hello: 'Welcome to Bwenge AI', helloName: (n) => `Muraho, ${n}!`,
  intro: "I'm <b>Bwenge AI</b>, your education, research and data companion. Ask in English, French or Kinyarwanda.",
  whatICanDo: 'What I can do',
  capabilities: [['📊', 'Charts, Excel, Word, PowerPoint and PDF files'], ['🧮', 'Statistics on your spreadsheets'], ['🔎', 'Answers from your knowledge library, with sources'], ['📝', 'Mark exam scripts and send the results'], ['📷', 'Scan papers with your camera and read handwriting']],
  homeFooter: 'Type a request or send a file to begin.',
  tryAsking: 'Try asking', working: 'Working on it', settings: 'Settings', language: 'Language', langName: 'English', account: 'Account',
  notLinked: 'not linked', linkHint: 'Link your Bwenge account in Settings → Connections on bwenge.space to use your files and plan here.',
  myFiles: 'My files', noFiles: 'Nothing yet. Ask me for a chart, a workbook or a report and it will appear here.',
  filesFooter: (p, n) => `Page ${p} of ${n} · tap ⬇️ to receive a file again`,
  errorTitle: 'Something went wrong', errorBody: 'I could not finish that request.', errorFooter: 'Nothing was charged. Try again in a moment.',
  fileTooLarge: 'That file is larger than 20 MB, which is the most Telegram lets bots download. Send a smaller file or share it on bwenge.space.',
  unsupportedMessage: 'I can read text, photos, documents and voice notes. Send one of those and I will take it from there.',
  slowDown: 'You are sending messages very fast. Give me a few seconds to catch up.',
  fileMissing: 'That file is no longer available.', nothingToRegenerate: 'There is no earlier request to repeat.', languageSet: 'Language updated',
  receivedFile: (n) => `Received <b>${n}</b>. What should I do with it?`, readyCaption: 'Ready',
  scan: {
    title: 'Document scanner', body: 'Scan exam scripts, marking schemes or any handwritten page with your phone camera.',
    steps: ['Point the camera at the page; the edges are found for you', 'Adjust the corners and pick a filter if needed', 'Add more pages or another student, then tap <b>Send to Telegram</b>'],
    footer: 'The scan arrives here as one PDF per student, ready to transcribe or mark.', open: '📷 Open scanner',
    groupHint: 'The link works for 30 minutes.', received: (p) => `Scanned PDF · ${p}. What should I do with it?`,
  },
  profile: {
    description: 'Bwenge AI is your education, research and data companion.\n\n📊 Charts, Excel, Word and PDF files\n📝 Exam marking with results sheets\n📷 Document scanner and handwriting reading\n🔎 Answers from your knowledge library\n\nWrite in English, Kinyarwanda or French.',
    short: 'Your education, research & data companion: sourced answers, charts, files, marking and scanning.', menuButton: 'Scan',
  },
  ago: { now: 'just now', min: (n) => `${n} min ago`, hour: (n) => `${n} h ago` },
  buttons: { create: '📊 Charts & files', mark: '📝 Mark exams', scan: '📷 Scan papers', transcribe: '📄 Transcribe', library: '🔎 Ask my library', files: '📁 My files', settings: '⚙️ Settings', help: '❓ Help', back: '‹ Back', regenerate: '🔁 Regenerate', menu: '🏠 Menu', retry: '🔁 Try again' },
  guides: {
    create: { icon: '📊', title: 'Charts and files', body: 'Describe what you need and include the numbers, or send a CSV or Excel file. I create real files: charts, Excel workbooks, Word reports, PowerPoint decks and PDFs.', examples: ['Make a bar chart of A=10, B=20, C=15 and give me an Excel file', 'Turn this CSV into a report with the average per district', 'Create a 5-slide deck on the water cycle'] },
    mark: { icon: '📝', title: 'Mark exams', body: 'Send the marking scheme, then the students’ scripts (photos or PDFs). I mark every script against the scheme and send back marked PDFs and an Excel results sheet.', examples: ['Mark these scripts using the marking scheme', 'Show the class average and the hardest question'] },
    transcribe: { icon: '📄', title: 'Transcribe', body: 'Send a photo or PDF of handwriting with the caption /transcribe. I return the typed text, and point out anything I could not read.', examples: ['/transcribe'] },
    library: { icon: '🔎', title: 'Ask my library', body: 'Ask questions about documents in your Bwenge knowledge library. Answers cite the file and page they come from.', examples: ['What does the curriculum say about S2 statistics?', 'Summarise the 2024 enrolment report'] },
    help: { icon: '❓', title: 'Help', body: 'Just write what you need, or send a file. Commands: /start menu · /files your files · /settings language and account · /help this guide · /new start a fresh conversation.', examples: ['What can you do?'] },
  },
  commands: [
    { command: 'start', description: 'Home menu' }, { command: 'new', description: 'Start a fresh conversation' }, { command: 'files', description: 'My files' },
    { command: 'settings', description: 'Language and account' }, { command: 'transcribe', description: 'Transcribe handwriting' }, { command: 'scan', description: 'Open the document scanner' },
    { command: 'grade', description: 'Batch grading' }, { command: 'help', description: 'How to use Bwenge' },
  ],
};

const rw: Copy = {
  ...en,
  hello: 'Murakaza neza kuri Bwenge AI', helloName: (n) => `Muraho, ${n}!`,
  intro: 'Ndi <b>Bwenge AI</b>, mugenzi wawe mu burezi, ubushakashatsi n’imibare. Mbaza mu Kinyarwanda, Icyongereza cyangwa Igifaransa.',
  whatICanDo: 'Icyo nshobora gukora',
  capabilities: [['📊', 'Ibishushanyo, Excel, Word, PowerPoint na PDF'], ['🧮', 'Imibare n’isesengura ry’amakuru yawe'], ['🔎', 'Ibisubizo biva mu isomero ryawe, n’aho byavuye'], ['📝', 'Gukosora ibizamini no kohereza amanota'], ['📷', 'Gusikana impapuro na kamera no gusoma inyandiko y’intoki']],
  homeFooter: 'Andika icyo ukeneye cyangwa wohereze dosiye.',
  tryAsking: 'Gerageza kubaza', working: 'Ndimo kubikora', settings: 'Igenamiterere', language: 'Ururimi', langName: 'Kinyarwanda', account: 'Konti',
  notLinked: 'ntihuzwa', linkHint: 'Huza konti yawe ya Bwenge muri Settings → Connections kuri bwenge.space kugira ngo ukoreshe dosiye zawe hano.',
  myFiles: 'Dosiye zanjye', noFiles: 'Nta kintu kirahari. Nsaba igishushanyo, Excel cyangwa raporo, bizagaragara hano.',
  filesFooter: (p, n) => `Urupapuro ${p}/${n} · kanda ⬇️ kugira ngo wongere uhabwe dosiye`,
  errorTitle: 'Habaye ikibazo', errorBody: 'Sinashoboye kurangiza icyo usabye.', errorFooter: 'Nta kiguzi cyakuweho. Ongera ugerageze mu kanya.',
  fileTooLarge: 'Iyi dosiye irenze MB 20, ingano ntarengwa Telegram yemerera bots. Ohereza ntoya cyangwa uyinyuze kuri bwenge.space.',
  unsupportedMessage: 'Nsoma inyandiko, amafoto, dosiye n’ubutumwa bw’ijwi. Ohereza kimwe muri ibyo.',
  slowDown: 'Urimo kohereza ubutumwa vuba cyane. Mpa amasegonda make.',
  fileMissing: 'Iyo dosiye ntikiboneka.', nothingToRegenerate: 'Nta busabe bwabanje bwo gusubiramo.', languageSet: 'Ururimi rwahinduwe',
  receivedFile: (n) => `Nakiriye <b>${n}</b>. Nkore iki?`, readyCaption: 'Byarangiye',
  scan: {
    title: 'Scanner y’inyandiko', body: 'Sikana impapuro z’ibizamini, marking scheme cyangwa urupapuro rwandikishijwe intoki ukoresheje kamera ya telefoni.',
    steps: ['Erekeza kamera ku rupapuro; impande ziboneka ubwazo', 'Hindura inguni uhitemo filter niba bikenewe', 'Ongeraho izindi mpapuro cyangwa undi munyeshuri, hanyuma ukande <b>Ohereza kuri Telegram</b>'],
    footer: 'Bizagera hano ari PDF imwe kuri buri munyeshuri, yiteguye kwandikwa cyangwa gukosorwa.', open: '📷 Fungura scanner',
    groupHint: 'Iyi link imara iminota 30.', received: (p) => `PDF yasikanwe · ${p}. Nkore iki?`,
  },
  profile: {
    description: 'Bwenge AI ni mugenzi wawe mu burezi, ubushakashatsi n’imibare.\n\n📊 Ibishushanyo, Excel, Word na PDF\n📝 Gukosora ibizamini n’amanota\n📷 Scanner n’isoma ry’inyandiko y’intoki\n🔎 Ibisubizo biva mu isomero ryawe\n\nAndika mu Kinyarwanda, Icyongereza cyangwa Igifaransa.',
    short: 'Mugenzi wawe mu burezi, ubushakashatsi n’imibare: ibisubizo, ibishushanyo, dosiye, gukosora na scanner.', menuButton: 'Scan',
  },
  ago: { now: 'ubu', min: (n) => `hashize iminota ${n}`, hour: (n) => `hashize amasaha ${n}` },
  buttons: { create: '📊 Ibishushanyo & dosiye', mark: '📝 Gukosora', scan: '📷 Sikana', transcribe: '📄 Kwandika', library: '🔎 Isomero', files: '📁 Dosiye zanjye', settings: '⚙️ Igenamiterere', help: '❓ Ubufasha', back: '‹ Subira inyuma', regenerate: '🔁 Ongera ukore', menu: '🏠 Ahabanza', retry: '🔁 Ongera ugerageze' },
  guides: {
    create: { ...en.guides.create, title: 'Ibishushanyo na dosiye', body: 'Sobanura icyo ukeneye ushyiremo imibare, cyangwa wohereze CSV cyangwa Excel. Nkora dosiye nyazo: ibishushanyo, Excel, Word, PowerPoint na PDF.', examples: ['Kora igishushanyo cy’inkingi cya A=10, B=20, C=15 umpe na Excel', 'Hindura iyi CSV raporo y’impuzandengo kuri buri karere'] },
    mark: { ...en.guides.mark, title: 'Gukosora ibizamini', body: 'Ohereza igisubizo nyacyo (marking scheme), hanyuma impapuro z’abanyeshuri (amafoto cyangwa PDF). Ndazikosora nkoherereza PDF zikosoye n’urupapuro rwa Excel rw’amanota.', examples: ['Kosora izi mpapuro ukoresheje marking scheme'] },
    transcribe: { ...en.guides.transcribe, title: 'Kwandika', body: 'Ohereza ifoto cyangwa PDF y’inyandiko yandikishijwe intoki wanditse /transcribe. Nkugarurira inyandiko yanditse.' },
    library: { ...en.guides.library, title: 'Isomero', body: 'Baza ibibazo ku nyandiko ziri mu isomero ryawe rya Bwenge. Ibisubizo bigaragaza dosiye n’urupapuro byavuyemo.', examples: ['Integanyanyigisho ivuga iki ku mibare ya S2?'] },
    help: { ...en.guides.help, title: 'Ubufasha', body: 'Andika icyo ukeneye cyangwa wohereze dosiye. Amabwiriza: /start ahabanza · /files dosiye zawe · /settings ururimi na konti · /help ubu bufasha · /new ikiganiro gishya.', examples: ['Ushobora gukora iki?'] },
  },
  commands: [
    { command: 'start', description: 'Ahabanza' }, { command: 'new', description: 'Ikiganiro gishya' }, { command: 'files', description: 'Dosiye zanjye' },
    { command: 'settings', description: 'Ururimi na konti' }, { command: 'transcribe', description: 'Kwandika inyandiko y’intoki' }, { command: 'scan', description: 'Scanner y’inyandiko' },
    { command: 'grade', description: 'Gukosora ibizamini byinshi' }, { command: 'help', description: 'Uko wakoresha Bwenge' },
  ],
};

const fr: Copy = {
  ...en,
  hello: 'Bienvenue sur Bwenge AI', helloName: (n) => `Bonjour, ${n} !`,
  intro: 'Je suis <b>Bwenge AI</b>, votre compagnon pour l’éducation, la recherche et les données. Écrivez en français, en anglais ou en kinyarwanda.',
  whatICanDo: 'Ce que je sais faire',
  capabilities: [['📊', 'Graphiques, fichiers Excel, Word, PowerPoint et PDF'], ['🧮', 'Statistiques sur vos tableurs'], ['🔎', 'Réponses tirées de votre bibliothèque, avec sources'], ['📝', 'Correction de copies et envoi des résultats'], ['📷', 'Scanner de documents et lecture de l’écriture manuscrite']],
  homeFooter: 'Écrivez une demande ou envoyez un fichier pour commencer.',
  tryAsking: 'Exemples', working: 'Je m’en occupe', settings: 'Paramètres', language: 'Langue', langName: 'Français', account: 'Compte',
  notLinked: 'non lié', linkHint: 'Liez votre compte Bwenge dans Settings → Connections sur bwenge.space pour utiliser vos fichiers ici.',
  myFiles: 'Mes fichiers', noFiles: 'Rien pour l’instant. Demandez un graphique, un classeur ou un rapport : il apparaîtra ici.',
  filesFooter: (p, n) => `Page ${p} sur ${n} · touchez ⬇️ pour recevoir un fichier`,
  errorTitle: 'Un problème est survenu', errorBody: 'Je n’ai pas pu terminer cette demande.', errorFooter: 'Rien n’a été facturé. Réessayez dans un instant.',
  fileTooLarge: 'Ce fichier dépasse 20 Mo, la limite de Telegram pour les bots. Envoyez un fichier plus petit ou passez par bwenge.space.',
  unsupportedMessage: 'Je lis le texte, les photos, les documents et les messages vocaux.',
  slowDown: 'Vous envoyez des messages très vite. Laissez-moi quelques secondes.',
  fileMissing: 'Ce fichier n’est plus disponible.', nothingToRegenerate: 'Aucune demande précédente à relancer.', languageSet: 'Langue mise à jour',
  receivedFile: (n) => `<b>${n}</b> reçu. Que dois-je en faire ?`, readyCaption: 'Prêt',
  scan: {
    title: 'Scanner de documents', body: 'Scannez des copies, des barèmes ou toute page manuscrite avec l’appareil photo de votre téléphone.',
    steps: ['Visez la page : les bords sont détectés automatiquement', 'Ajustez les coins et choisissez un filtre si besoin', 'Ajoutez des pages ou un autre élève, puis touchez <b>Envoyer sur Telegram</b>'],
    footer: 'Le scan arrive ici, un PDF par élève, prêt à transcrire ou à corriger.', open: '📷 Ouvrir le scanner',
    groupHint: 'Le lien est valable 30 minutes.', received: (p) => `PDF scanné · ${p}. Que dois-je en faire ?`,
  },
  profile: {
    description: 'Bwenge AI est votre compagnon pour l’éducation, la recherche et les données.\n\n📊 Graphiques, fichiers Excel, Word et PDF\n📝 Correction de copies avec tableau de résultats\n📷 Scanner de documents et lecture manuscrite\n🔎 Réponses tirées de votre bibliothèque\n\nÉcrivez en français, en anglais ou en kinyarwanda.',
    short: 'Votre compagnon éducation, recherche et données : réponses sourcées, graphiques, fichiers, correction, scanner.', menuButton: 'Scanner',
  },
  ago: { now: 'à l’instant', min: (n) => `il y a ${n} min`, hour: (n) => `il y a ${n} h` },
  buttons: { create: '📊 Graphiques & fichiers', mark: '📝 Corriger', scan: '📷 Scanner', transcribe: '📄 Transcrire', library: '🔎 Ma bibliothèque', files: '📁 Mes fichiers', settings: '⚙️ Paramètres', help: '❓ Aide', back: '‹ Retour', regenerate: '🔁 Régénérer', menu: '🏠 Menu', retry: '🔁 Réessayer' },
  guides: {
    create: { ...en.guides.create, title: 'Graphiques et fichiers', body: 'Décrivez ce qu’il vous faut avec les chiffres, ou envoyez un CSV ou un Excel. Je crée de vrais fichiers : graphiques, classeurs Excel, rapports Word, présentations et PDF.', examples: ['Fais un diagramme en barres de A=10, B=20, C=15 et donne-moi un fichier Excel'] },
    mark: { ...en.guides.mark, title: 'Corriger des copies', body: 'Envoyez le barème, puis les copies (photos ou PDF). Je corrige chaque copie et renvoie les PDF annotés et un tableau Excel des résultats.', examples: ['Corrige ces copies avec le barème'] },
    transcribe: { ...en.guides.transcribe, title: 'Transcrire', body: 'Envoyez une photo ou un PDF manuscrit avec la légende /transcribe. Je renvoie le texte tapé.' },
    library: { ...en.guides.library, title: 'Ma bibliothèque', body: 'Posez des questions sur les documents de votre bibliothèque Bwenge. Les réponses citent le fichier et la page.', examples: ['Que dit le programme sur les statistiques en S2 ?'] },
    help: { ...en.guides.help, title: 'Aide', body: 'Écrivez ce dont vous avez besoin ou envoyez un fichier. Commandes : /start menu · /files fichiers · /settings langue et compte · /help aide · /new nouvelle conversation.', examples: ['Que sais-tu faire ?'] },
  },
  commands: [
    { command: 'start', description: 'Menu principal' }, { command: 'new', description: 'Nouvelle conversation' }, { command: 'files', description: 'Mes fichiers' },
    { command: 'settings', description: 'Langue et compte' }, { command: 'transcribe', description: 'Transcrire un manuscrit' }, { command: 'scan', description: 'Scanner de documents' },
    { command: 'grade', description: 'Correction par lots' }, { command: 'help', description: 'Mode d’emploi' },
  ],
};

const ALL: Record<Lang, Copy> = { en, rw, fr };
export const copy = (lang: Lang): Copy => ALL[lang] ?? en;
