"use client";
export default function ErrorPage({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main id="main" className="policy-page">
      <p className="eyebrow">WE COULDN’T LOAD THIS PAGE</p>
      <h1>Let’s try that again.</h1>
      <p>
        Your completed claims and redemptions remain saved. Try again in a
        moment.
      </p>
      <button className="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
