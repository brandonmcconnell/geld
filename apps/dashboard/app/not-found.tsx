import Link from 'next/link';
export default function NotFound() {
  return (
    <div className="page">
      <h1>This page could not be found</h1>
      <p>Check the provider, repository and pull request number.</p>
      <Link href="/">Back to your queue</Link>
    </div>
  );
}
