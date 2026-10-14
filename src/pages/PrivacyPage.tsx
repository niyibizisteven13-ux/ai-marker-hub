import React from 'react';
import { ArrowLeft, Lock, Mail } from 'lucide-react';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#262624] text-[#FAF9F5] flex flex-col">
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
          href="mailto:support@bwenge.space?subject=Support%20Ticket%20-%20Privacy%20Inquiry"
          className="flex items-center gap-2 text-xs font-medium text-[#D97757] hover:underline"
        >
          <Mail size={14} /> support@bwenge.space
        </a>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-12 flex-1 space-y-8">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#D97757]/10 text-[#D97757] text-xs font-semibold tracking-wider uppercase border border-[#D97757]/20">
            <Lock size={12} /> Data Protection & Privacy
          </div>
          <h1 className="text-3xl md:text-4xl font-normal font-['Georgia',serif] tracking-tight text-[#FAF9F5]">
            Privacy Policy
          </h1>
          <p className="text-xs text-[#A0A0AA]">Last updated: October 14, 2026</p>
        </div>

        <div className="space-y-6 text-sm text-[#C2B59B] leading-relaxed border-t border-[#3E3E3A] pt-8">
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#FAF9F5]">1. Overview</h2>
            <p>
              At Bwenge AI Studio, protecting your privacy and student educational data is our highest priority. This Privacy Policy explains what information we collect, how we use it, and how we secure your data.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#FAF9F5]">2. Information We Collect</h2>
            <p>
              We collect account registration details (such as your name and email address), uploaded exam papers, rubrics, student submissions, and interaction logs necessary to deliver AI-powered grading and workspace features.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#FAF9F5]">3. How We Use Your Data</h2>
            <p>
              Your data is used solely to provide, maintain, and improve Bwenge AI services, including grading calibration, document scanning, and personalized workspace history. We do not sell user or student data to third parties.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#FAF9F5]">4. AI Model Training & Data Control</h2>
            <p>
              By default, your private student submissions and grading data are not used to train public AI models. You maintain full control over data retention and can export or delete your workspace history at any time.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#FAF9F5]">5. Data Security</h2>
            <p>
              We employ enterprise-grade encryption in transit (TLS 1.3) and at rest, secure HTTP-only session cookies, and strict role-based access controls to protect your data against unauthorized access.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#FAF9F5]">6. Questions & Support Tickets</h2>
            <p>
              If you have any questions regarding privacy, data export, or security compliance, please raise a support ticket by contacting our team at{' '}
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
