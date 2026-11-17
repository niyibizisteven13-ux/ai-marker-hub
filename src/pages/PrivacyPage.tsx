import LegalDocument, { type LegalSection } from '../components/LegalDocument';

/** The wording below is the owner's, unchanged; only its layout lives in LegalDocument. */
const SECTIONS: LegalSection[] = [
  { id: 'overview', title: '1. Overview', body: <>At Bwenge AI Studio, protecting your privacy and student educational data is our highest priority. This Privacy Policy explains what information we collect, how we use it, and how we secure your data.</> },
  { id: 'information-we-collect', title: '2. Information We Collect', body: <>We collect account registration details (such as your name and email address), uploaded exam papers, rubrics, student submissions, and interaction logs necessary to deliver AI-powered grading and workspace features.</> },
  { id: 'how-we-use-your-data', title: '3. How We Use Your Data', body: <>Your data is used solely to provide, maintain, and improve Bwenge AI services, including grading calibration, document scanning, and personalized workspace history. We do not sell user or student data to third parties.</> },
  { id: 'ai-model-training-data-control', title: '4. AI Model Training & Data Control', body: <>By default, your private student submissions and grading data are not used to train public AI models. You maintain full control over data retention and can export or delete your workspace history at any time.</> },
  { id: 'data-security', title: '5. Data Security', body: <>We employ enterprise-grade encryption in transit (TLS 1.3) and at rest, secure HTTP-only session cookies, and strict role-based access controls to protect your data against unauthorized access.</> },
  { id: 'questions-support-tickets', title: '6. Questions & Support Tickets', body: <>If you have any questions regarding privacy, data export, or security compliance, please raise a support ticket by contacting our team at{' '}<a href="mailto:support@bwenge.space" >support@bwenge.space</a>.</> },
];

export default function PrivacyPage() {
  return <LegalDocument title='Privacy Policy' summary='What information Bwenge collects, how it is used and how it is protected.' updated='October 14, 2026' sections={SECTIONS} other={{ label: 'Terms of Service', href: '/terms' }} />;
}
