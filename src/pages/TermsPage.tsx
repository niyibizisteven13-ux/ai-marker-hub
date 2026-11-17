import LegalDocument, { type LegalSection } from '../components/LegalDocument';

/** The wording below is the owner's, unchanged; only its layout lives in LegalDocument. */
const SECTIONS: LegalSection[] = [
  { id: 'acceptance-of-terms', title: '1. Acceptance of Terms', body: <>By accessing or using Bwenge AI Studio ("Bwenge", "we", "our", or "us"), you agree to be bound by these Terms of Service. If you do not agree to all of these terms, do not use our platform, APIs, or AI marking services.</> },
  { id: 'description-of-services', title: '2. Description of Services', body: <>Bwenge AI Studio provides advanced AI-powered grading, document scanning, rubric analysis, form authoring, and workspace collaboration tools designed for educational institutions, instructors, and independent examiners.</> },
  { id: 'user-accounts-security', title: '3. User Accounts & Security', body: <>You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You agree to notify us immediately of any unauthorized use at <a href="mailto:support@bwenge.space" >support@bwenge.space</a>.</> },
  { id: 'acceptable-use', title: '4. Acceptable Use', body: <>You agree not to misuse the Bwenge platform. Prohibited activities include attempting to bypass rate limits, reverse-engineering our AI models, uploading malicious code, or violating student data privacy regulations.</> },
  { id: 'intellectual-property-data-rights', title: '5. Intellectual Property & Data Rights', body: <>You retain full ownership of all student submissions, exam papers, and educational content uploaded to Bwenge. Bwenge claims no ownership over your intellectual property.</> },
  { id: 'limitation-of-liability', title: '6. Limitation of Liability', body: <>Bwenge AI Studio is provided on an "as is" and "as available" basis. While our AI grading models achieve high calibration accuracy, final academic grading decisions remain the responsibility of the human instructor. Bwenge is not liable for indirect or consequential damages.</> },
  { id: 'contact-support', title: '7. Contact & Support', body: <>For any questions regarding these Terms of Service or to raise support tickets, please contact our support team at{' '}<a href="mailto:support@bwenge.space" >support@bwenge.space</a>.</> },
];

export default function TermsPage() {
  return <LegalDocument title='Terms of Service' summary='The rules for using Bwenge: what you can do, what we provide and what each of us is responsible for.' updated='October 14, 2026' sections={SECTIONS} other={{ label: 'Privacy Policy', href: '/privacy' }} />;
}
