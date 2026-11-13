import { NewPasswordForm } from "@/components/auth/NewPasswordForm";

export default function NewPasswordPage() {
  return (
    <section className="stack" style={{ maxWidth: 480 }}>
      <div className="card">
        <NewPasswordForm />
      </div>
    </section>
  );
}
