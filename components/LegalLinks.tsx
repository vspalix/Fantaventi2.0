import Link from "next/link";

export function LegalLinks() {
  return (
    <p className="small muted legal-links">
      <Link href="/privacy">Privacy</Link>
      <span aria-hidden="true"> · </span>
      <Link href="/termini">Termini</Link>
    </p>
  );
}
