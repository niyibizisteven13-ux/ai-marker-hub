import { useEffect } from 'react';

const description = 'Discover Bwenge.space tools for Rwanda data analysis, AI-assisted exam marking, surveys, learning, business pages and secure online assessments.';

const offerings = [
  {
    title: 'Bwenge AI and data analysis',
    text: 'Ask questions about published datasets and your own CSV or Excel files. Explore evidence with source citations, charts, tables and downloadable reports.',
  },
  {
    title: 'Public Dataset Library',
    text: 'Browse curated public statistics, including Rwanda datasets, and explore what files, tables and indicators contain without starting with a manual download.',
  },
  {
    title: 'Exam marking and document scanning',
    text: 'Help teachers review student scripts, apply marking criteria, scan paper documents and prepare feedback and class results. Teachers stay in control of marks before release.',
  },
  {
    title: 'Forms, surveys and research',
    text: 'Create and publish digital forms, collect responses, and analyse survey data with clear summaries and suitable statistical methods.',
  },
  {
    title: 'AI learning tools',
    text: 'Use a Socratic tutor, adaptive practice questions and roleplay activities to build understanding and practise skills.',
  },
  {
    title: 'Bwenge4Biz',
    text: 'Give a business a public online page and use digital tools to support its everyday customer and business workflows.',
  },
  {
    title: 'Bwenge4Profile',
    text: 'Create a public professional profile to present your experience, skills, work and updates in one shareable place.',
  },
  {
    title: 'MySEB secure assessments',
    text: 'Support institution-led online assessments with a dedicated secure exam browser and live assessment workflows.',
  },
  {
    title: 'Developer and institution integrations',
    text: 'Connect indexed datasets to other services through Bwenge APIs, or explore the platform through its Telegram bot.',
  },
];

export default function AboutPage() {
  useEffect(() => {
    const oldTitle = document.title;
    const oldDescription = document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content;
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const oldCanonical = canonical?.href;
    document.title = 'About Bwenge.space | AI, Data, Learning & Business Tools';
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.appendChild(meta);
    }
    meta.content = description;
    let link = canonical;
    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.appendChild(link);
    }
    link.href = 'https://www.bwenge.space/about';
    return () => {
      document.title = oldTitle;
      if (oldDescription === undefined) meta?.remove();
      else if (meta) meta.content = oldDescription;
      if (oldCanonical === undefined) link?.remove();
      else if (link) link.href = oldCanonical;
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#07111f] text-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6 sm:px-8">
        <a href="/" className="text-xl font-bold tracking-tight" aria-label="Bwenge home">Bwenge<span className="text-teal-300">.space</span></a>
        <nav className="flex items-center gap-4 text-sm">
          <a href="/get-app" className="text-slate-300 hover:text-white">Get the app</a>
          <a href="/signup" className="rounded-lg bg-teal-300 px-4 py-2 font-semibold text-slate-950 hover:bg-teal-200">Create an account</a>
        </nav>
      </header>
      <div className="mx-auto max-w-6xl px-5 pb-16 pt-10 sm:px-8 sm:pt-16">
        <section className="max-w-3xl">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-teal-300">AI tools made for real work</p>
          <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-6xl">One platform for data, learning, research and business</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
            Bwenge.space brings practical AI tools together for learners, teachers, researchers, institutions and businesses in Rwanda and beyond. Explore datasets, create forms, review student work, learn new skills and build a public presence.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="/signup" className="rounded-lg bg-teal-300 px-5 py-3 font-semibold text-slate-950 hover:bg-teal-200">Get started with Bwenge</a>
            <a href="/" className="rounded-lg border border-white/20 px-5 py-3 font-semibold hover:bg-white/5">Sign in</a>
          </div>
        </section>

        <section className="mt-16" aria-labelledby="products-heading">
          <div className="max-w-2xl">
            <h2 id="products-heading" className="text-2xl font-bold sm:text-3xl">Bwenge products and services</h2>
            <p className="mt-3 leading-7 text-slate-300">Choose the tools that fit your work. Features and access may vary by account or institution.</p>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {offerings.map((item) => (
              <article key={item.title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                <h3 className="text-lg font-semibold text-teal-200">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-300">{item.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-16 grid gap-8 border-t border-white/10 pt-10 md:grid-cols-2">
          <div>
            <h2 className="text-2xl font-bold">For learners and educators</h2>
            <p className="mt-3 leading-7 text-slate-300">Use guided AI learning, practice activities, digital forms and teacher-reviewed assessment tools to support learning and classroom work.</p>
          </div>
          <div>
            <h2 className="text-2xl font-bold">For researchers and institutions</h2>
            <p className="mt-3 leading-7 text-slate-300">Find and explore published data, analyse survey responses and connect datasets to digital workflows through APIs and integrations.</p>
          </div>
        </section>

        <section className="mt-16 border-t border-white/10 pt-12" aria-labelledby="founder-heading">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-300">The story behind Bwenge</p>
            <h2 id="founder-heading" className="mt-3 text-3xl font-bold">Built from problems Steven experienced and observed</h2>
            <p className="mt-4 leading-7 text-slate-300">
              Niyibizi Steven founded Bwenge.space while studying Economics at the University of Rwanda in Huye and pursuing Data Science concurrently at another university. He began with a practical question: could AI help lecturers mark papers more quickly?
            </p>
          </div>

          <div className="mt-8 grid gap-5 lg:grid-cols-2">
            <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
              <h3 className="text-lg font-semibold text-teal-200">From handwritten marking to faster feedback</h3>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                Early experiments showed that AI could help with handwritten scripts, but processing large volumes could use many tokens and make API costs too high to sustain. Steven looked for another way to reduce marking delays. Online tasks and assessments that return marks promptly became an important alternative, while teacher review remains central to marking decisions.
              </p>
            </article>

            <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
              <h3 className="text-lg font-semibold text-teal-200">A Google Forms experience that raised questions</h3>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                During an employment exercise delivered through Google Forms, Steven submitted answers but received no marks or feedback. He also admits that he opened another browser tab and searched for answers with AI while completing it. The experience felt frustrating and exposed two gaps: applicants could use outside help, while the form gave them no clear result. It pushed him to think about assessment integrity and timely feedback together.
              </p>
            </article>

            <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
              <h3 className="text-lg font-semibold text-teal-200">Making small businesses easier to find</h3>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                Steven saw that many businesses need an online presence and practical ways to track their work, but building a custom website from scratch can be a barrier. Bwenge4Biz is intended to help businesses present themselves online and use connected digital tools without starting every time from a blank website.
              </p>
            </article>

            <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
              <h3 className="text-lg font-semibold text-teal-200">Giving students a place to introduce themselves</h3>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                When students are asked in class to explain who they are and what they can do, they may not have a page that brings their skills, projects and goals together. That need inspired Bwenge4Profile: a shareable space where students and professionals can present themselves in their own words.
              </p>
              <a href="https://bwenge.space/p/niyibizisteven" className="mt-4 inline-flex text-sm font-semibold text-teal-200 underline decoration-teal-200/40 underline-offset-4 hover:text-white">
                View Steven’s Bwenge4Profile
              </a>
            </article>
          </div>


        </section>

        <section className="mt-16 rounded-2xl border border-teal-200/20 bg-teal-200/[0.07] p-7 sm:p-10">
          <h2 className="text-2xl font-bold">Explore Bwenge.space</h2>
          <p className="mt-3 max-w-2xl leading-7 text-slate-300">Start with the tool that solves your task, then bring more of your learning, data and work into one connected platform.</p>
          <a href="/signup" className="mt-6 inline-flex rounded-lg bg-teal-300 px-5 py-3 font-semibold text-slate-950 hover:bg-teal-200">Create your Bwenge account</a>
        </section>
        <footer className="mt-14 flex flex-wrap gap-x-6 gap-y-3 border-t border-white/10 pt-6 text-sm text-slate-400">
          <a href="/privacy" className="hover:text-white">Privacy</a>
          <a href="/terms" className="hover:text-white">Terms</a>
          <a href="mailto:support@bwenge.space" className="hover:text-white">Contact support</a>
          <span>© 2026 Bwenge.space</span>
        </footer>
      </div>
    </main>
  );
}
