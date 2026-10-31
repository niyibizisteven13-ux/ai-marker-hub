import React from 'react';
import { ArrowLeft, Shield, Mail } from 'lucide-react';

export default function TermsPage() {
  return (
    <div className="h-[100dvh] overflow-y-auto bg-[#262624] text-[#FAF9F5] flex flex-col">
      {/* Header */}
      <header className="border-b border-[#3E3E3A] px-6 py-4 flex items-center justify-between bg-[#21211F]/80 backdrop-blur sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              window.history.pushState({}, '', '/');
              window.dispatchEvent(new Event('popstate'));
              window.location.reload();
            }}
            className="flex items-center gap-2 text-xs font-medium text-[#C2B59B] hover:text-[#FAF9F5] transition-colors bg-[#2E2E2A] px-3 py-1.5 rounded-lg border border-[#3E3E3A]"
          >
            <ArrowLeft size={14} /> Back to Bwenge
          </button>
          <span className="text-sm font-semibold tracking-wide text-[#FAF9F5]">Bwenge AI Studio</span>
        </div>
        <a
          href="mailto:support@bwenge.space?subject=Support%20Ticket%20-%20Terms%20Inquiry"
          className="flex items-center gap-2 text-xs font-medium text-[#D97757] hover:underline"
        >
          <Mail size={14} /> support@bwenge.space
        </a>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-12 flex-1 space-y-8">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#D97757]/10 text-[#D97757] text-xs font-semibold tracking-wider uppercase border border-[#D97757]/20">
            <Shield size={12} /> Legal Agreement
          </div>
          <h1 className="text-3xl md:text-4xl font-normal font-['Georgia',serif] tracking-tight text-[#FAF9F5]">
            Terms of Service
          </h1>
          <p className="text-xs text-[#A0A0AA]">Last updated: October 14, 2026</p>
        </div>

        <div className="space-y-6 text-sm text-[#C2B59B] leading-relaxed border-t border-[#3E3E3A] pt-8">
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#FAF9F5]">1. Acceptance of Terms</h2>
            <p>
              By accessing or using Bwenge AI Studio ("Bwenge", "we", "our", or "us"), you agree to be bound by these Terms of Service. If you do not agree to all of these terms, do not use our platform, APIs, or AI marking services.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#FAF9F5]">2. Description of Services</h2>
            <p>
              Bwenge AI Studio provides advanced AI-powered grading, document scanning, rubric analysis, form authoring, and workspace collaboration tools designed for educational institutions, instructors, and independent examiners.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#FAF9F5]">3. User Accounts & Security</h2>
            <p>
              You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You agree to notify us immediately of any unauthorized use at <a href="mailto:support@bwenge.space" className="text-[#D97757] underline">support@bwenge.space</a>.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#FAF9F5]">4. Acceptable Use</h2>
            <p>
              You agree not to misuse the Bwenge platform. Prohibited activities include attempting to bypass rate limits, reverse-engineering our AI models, uploading malicious code, or violating student data privacy regulations.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#FAF9F5]">5. Intellectual Property & Data Rights</h2>
            <p>
              You retain full ownership of all student submissions, exam papers, and educational content uploaded to Bwenge. Bwenge claims no ownership over your intellectual property.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#FAF9F5]">6. Limitation of Liability</h2>
            <p>
              Bwenge AI Studio is provided on an "as is" and "as available" basis. While our AI grading models achieve high calibration accuracy, final academic grading decisions remain the responsibility of the human instructor. Bwenge is not liable for indirect or consequential damages.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#FAF9F5]">7. Contact & Support</h2>
            <p>
              For any questions regarding these Terms of Service or to raise support tickets, please contact our support team at{' '}
              <a href="mailto:support@bwenge.space" className="text-[#D97757] underline font-medium">support@bwenge.space</a>.
            </p>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#3E3E3A] px-6 py-6 text-center text-xs text-[#A0A0AA] bg-[#21211F]">
        © 2026 Bwenge AI Studio · All rights reserved.
      </footer>
    </div>
  );
}
