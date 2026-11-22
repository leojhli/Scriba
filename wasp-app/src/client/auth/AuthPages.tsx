import { LoginForm, SignupForm } from "wasp/client/auth";
import { Link } from "wasp/client/router";
import "../Main.css";

export function LoginPage() {
  return (
    <main className="container">
      <LoginForm />
      <p className="content">
        No account? <Link to="/signup">Sign up</Link>
      </p>
    </main>
  );
}

export function SignupPage() {
  return (
    <main className="container">
      <SignupForm />
      <p className="content">
        Have an account? <Link to="/login">Log in</Link>
      </p>
    </main>
  );
}
