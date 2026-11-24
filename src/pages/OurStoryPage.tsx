import { useEffect } from 'react';

export default function OurStoryPage() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Our story | Bwenge.space';
    return () => { document.title = previousTitle; };
  }, []);

  return (
    <div className="h-[100dvh] overflow-y-auto bg-[#07111f] text-white">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-6 sm:px-8">
        <a href="/" aria-label="Bwenge home" className="text-xl font-bold">Bwenge<span className="text-teal-300">.space</span></a>
        <a href="/about" className="text-sm text-slate-300 hover:text-white">About Bwenge</a>
      </header>
      <main className="mx-auto max-w-5xl px-5 pb-16 pt-10 sm:px-8 sm:pt-16">
        <article>
          <header className="border-b border-white/10 pb-10">
            <h1 className="font-display text-4xl font-bold tracking-tight sm:text-6xl">Our story</h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300">
              Bwenge began in Huye, Rwanda, with a question from founder Niyibizi Steven. Could AI help lecturers spend less time marking papers?
            </p>
          </header>
          <div className="mt-10 max-w-3xl space-y-10 text-base leading-8 text-slate-300 [&_h2]:mb-3 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:text-white [&_p+p]:mt-4">
            <section aria-labelledby="marking">
              <h2 id="marking">It started with handwritten exams</h2>
              <p>Steven, a University of Rwanda student based in Huye, was pursuing economics and data science concurrently at different universities. He began experimenting with AI-assisted marking to reduce the time lecturers spent reviewing handwritten exam scripts.</p>
              <p>The experiments showed that AI could assist with marking. Processing handwritten pages, however, used enough AI tokens to make the API costs difficult to sustain at scale. Moving assessments online gave Steven a way to collect answers in a format that was easier to grade and to give participants quicker feedback where appropriate.</p>
            </section>
            <section aria-labelledby="assessment">
              <h2 id="assessment">The recruitment test that shaped MySEB</h2>
              <p>During a recruitment assessment delivered through Google Forms, Steven switched tabs, asked an AI tool for help and returned to submit an answer. He knew it was unfair. He also finished the assessment without seeing his score. The experience made two needs concrete for him. Organizers needed more visibility during a test, and participants needed clearer feedback when organizers chose to release it.</p>
              <p><strong className="text-white">Forms &amp; Tasks</strong> grew out of the shift to online work. Organizers can create quizzes and forms, collect responses, and configure grading and feedback. Multiple-choice questions can be scored automatically, and organizers can choose when results are released.</p>
              <p><a href="/ms" className="font-semibold text-teal-300 underline underline-offset-4">MySEB</a> gives lecturers and other assessment organizers tools to run controlled online sessions, monitor activity in a live room, and review what happened during an assessment.</p>
            </section>
            <section aria-labelledby="business">
              <h2 id="business">Giving small businesses a place to work and be found</h2>
              <p>As Bwenge grew, Steven saw how small businesses had to coordinate daily records, staff responsibilities and customer-facing information across different places. <strong className="text-white">Bwenge4Biz</strong> brings together tools for business operations, team access and a public page where customers can see what the business offers.</p>
            </section>
            <section aria-labelledby="profile" className="rounded-2xl border border-teal-300/20 bg-teal-300/[0.06] p-5 sm:p-7">
              <h2 id="profile">Bwenge4Profile</h2>
              <p className="text-xl font-semibold text-teal-300">Pitch yourself professionally with one link.</p>
              <p>When someone asks what you do, your CV, examples of your work and recent updates may be scattered across different places. Bwenge4Profile gives you a public page for your professional bio, experience, work and updates. Share it in a job application, after a networking event, or when introducing yourself to a potential client.</p>
            </section>
            <section aria-labelledby="learning">
              <h2 id="learning">Learning and research beyond the test</h2>
              <p>The <strong className="text-white">Socratic Tutor</strong> guides learners through questions so they can work toward an answer step by step. The <strong className="text-white">Public Dataset Library</strong> helps students, researchers and other users discover public datasets for analysis and projects. Bwenge’s AI data tools also help people explore data, ask questions and present findings.</p>
              <p>What began as a marking experiment in Huye became a platform for people to run assessments, learn from data, manage a business and share their professional work.</p>
            </section>
          </div>
        </article>
        <footer className="mt-12 border-t border-white/10 pt-6 text-sm">
          <a href="/about" className="text-teal-300 underline underline-offset-4">Explore Bwenge products and services</a>
        </footer>
      </main>
    </div>
  );
}
