import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { toast } from "sonner";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const nav = useNavigate();

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await login(email, password);
      toast.success("Welcome back");
      nav("/admin");
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-2 bg-[#F9F8F6]" data-testid="admin-login-page">
      <div
        className="hidden md:block relative"
        style={{
          backgroundImage:
            "url('https://static.prod-images.emergentagent.com/jobs/2f57949b-850e-45f2-821a-37f7619e4a5c/images/77d79035e50340634e30acbc5051fe105574b01fb52a32f313c65202b664a62e.png')",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="absolute inset-0 bg-black/35" />
        <div className="absolute bottom-12 left-12 right-12 text-white fade-up">
          <div className="label-eyebrow text-white/80 mb-4">月 · Tsuki Restaurant</div>
          <h1 className="font-serif-jp text-5xl lg:text-6xl leading-none">
            An everyday<br/>ritual, reimagined.
          </h1>
          <p className="mt-6 text-white/80 max-w-md font-light">
            Operations console for menu, tables, and reservations.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-8 md:p-16">
        <form onSubmit={onSubmit} className="w-full max-w-sm space-y-6 fade-up" data-testid="admin-login-form">
          <div>
            <div className="label-eyebrow mb-3">Staff Sign-In</div>
            <h2 className="font-serif-jp text-3xl md:text-4xl">Welcome.</h2>
            <p className="text-sm text-[#8A817C] mt-2">Enter your credentials to access the console.</p>
          </div>

          <div className="space-y-4">
            <div>
              <Label htmlFor="email" className="label-eyebrow">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                data-testid="login-email-input"
                className="rounded-sm mt-2 h-11"
              />
            </div>
            <div>
              <Label htmlFor="password" className="label-eyebrow">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                data-testid="login-password-input"
                className="rounded-sm mt-2 h-11"
              />
            </div>
          </div>

          <Button
            type="submit"
            disabled={submitting}
            data-testid="login-submit-button"
            className="btn-aka w-full h-11 rounded-sm tracking-wide"
          >
            {submitting ? "Signing in…" : "Sign In"}
          </Button>

          {/* <p className="text-xs text-[#8A817C]">
            Demo: admin@restaurant.jp · admin123
          </p> */}
        </form>
      </div>
    </div>
  );
}
