import { useState } from 'react'
import {
  Shield,
  Fingerprint,
  Smartphone,
  UserCog,
  Truck,
  Car,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react'
import { isValidEstonianIsikukood } from './utils/isikukoodValidation'
import { signInWithGoogle } from './services/authSession'
import { recordAuditEvent } from './services/auditEventService'

export type UserRole = 'admin' | 'fleet-manager' | 'driver'

type AuthMethod = 'smart-id' | 'mobile-id'

const ROLES: { id: UserRole; label: string; icon: typeof UserCog; description: string }[] = [
  { id: 'admin', label: 'Admin', icon: UserCog, description: 'Full platform access' },
  { id: 'fleet-manager', label: 'Fleet Manager', icon: Truck, description: 'Manage vehicles & routes' },
  { id: 'driver', label: 'Driver', icon: Car, description: 'Field operations view' },
]

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  )
}

function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 7 && digits.length <= 15
}

/**
 * Login UI: Google uses real Supabase Auth OAuth.
 * Smart-ID / Mobile-ID remain mock/demo and never grant dashboard access.
 * Demo role tabs are cosmetic only — not authorization and never sent to App/profile.
 */
export default function Login() {
  const [role, setRole] = useState<UserRole>('admin')
  const [authMethod, setAuthMethod] = useState<AuthMethod>('smart-id')
  const [isikukood, setIsikukood] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const clearStatus = () => {
    setError(null)
    setSuccess(null)
  }

  /** Mock-only demo flows — do not create a Supabase session. */
  const simulateMockAuth = async (method: 'smart-id' | 'mobile-id', identifier?: string) => {
    clearStatus()
    setLoading(true)
    await new Promise((r) => setTimeout(r, 1400))
    setLoading(false)
    recordAuditEvent({
      category: 'Authentication',
      action: 'Mock authentication denied (demo only)',
      actorDisplayName: 'Unauthenticated user',
      resourceType: 'AuthMethod',
      resourceDisplayId: method === 'smart-id' ? 'Smart-ID (Demo)' : 'Mobile-ID (Demo)',
      severity: 'WARNING',
      result: 'DENIED',
      source: 'client-login-demo',
    })
    setSuccess(
      method === 'smart-id'
        ? `Demo only · Mock Smart-ID for ${identifier} — does not grant access. Use Google to sign in.`
        : `Demo only · Mock Mobile-ID for ${identifier} — does not grant access. Use Google to sign in.`,
    )
  }

  const handleSmartId = async () => {
    if (!isValidEstonianIsikukood(isikukood)) {
      setError('Enter a valid 11-digit Estonian Isikukood (Personal Code).')
      recordAuditEvent({
        category: 'Authentication',
        action: 'Smart-ID validation failed',
        actorDisplayName: 'Unauthenticated user',
        resourceType: 'AuthMethod',
        resourceDisplayId: 'Smart-ID (Demo)',
        severity: 'WARNING',
        result: 'FAILED',
        source: 'client-login-demo',
      })
      return
    }
    await simulateMockAuth('smart-id', isikukood)
  }

  const handleMobileId = async () => {
    if (!isValidPhone(phone)) {
      setError('Enter a valid phone number with country code.')
      recordAuditEvent({
        category: 'Authentication',
        action: 'Mobile-ID validation failed',
        actorDisplayName: 'Unauthenticated user',
        resourceType: 'AuthMethod',
        resourceDisplayId: 'Mobile-ID (Demo)',
        severity: 'WARNING',
        result: 'FAILED',
        source: 'client-login-demo',
      })
      return
    }
    await simulateMockAuth('mobile-id', phone)
  }

  const handleGoogle = async () => {
    clearStatus()
    setLoading(true)
    const result = await signInWithGoogle()
    if (result.errorMessage) {
      recordAuditEvent({
        category: 'Authentication',
        action: 'Google sign-in failed',
        actorDisplayName: 'Unauthenticated user',
        resourceType: 'AuthMethod',
        resourceDisplayId: 'Google OAuth',
        severity: 'WARNING',
        result: 'FAILED',
        source: 'client-auth-session',
      })
      setError(result.errorMessage)
      setLoading(false)
      return
    }
    // Browser redirects to Google / Supabase; session is restored on return.
    setSuccess('Redirecting to Google sign-in…')
  }

  const formatIsikukood = (value: string) => value.replace(/\D/g, '').slice(0, 11)

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0b0f1a] px-4 py-12 text-white antialiased">
      {/* Ambient background */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(59,130,246,0.18),transparent)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_100%_100%,rgba(99,102,241,0.12),transparent)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_40%_at_0%_80%,rgba(14,165,233,0.08),transparent)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff06_1px,transparent_1px),linear-gradient(to_bottom,#ffffff06_1px,transparent_1px)] bg-size-[3rem_3rem]" />
        <div className="absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-blue-500/10 blur-3xl" />
        <div className="absolute right-1/4 -bottom-24 h-80 w-80 rounded-full bg-indigo-600/10 blur-3xl" />
        <div className="absolute top-1/2 left-1/2 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-700/20 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Brand */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 bg-white/8 shadow-lg shadow-blue-500/10 backdrop-blur-xl">
            <Shield className="h-7 w-7 text-blue-300" strokeWidth={1.5} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            SovereignShield
          </h1>
          <p className="mt-1.5 text-sm text-white/45">
            Secure access to your fleet intelligence platform
          </p>
        </div>

        {/* Glass card */}
        <div className="overflow-hidden rounded-3xl border border-white/12 bg-white/6 shadow-2xl shadow-black/40 backdrop-blur-2xl">
          {/* Role tabs — cosmetic / demo only */}
          <div className="border-b border-white/8 bg-white/3 p-1.5">
            <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35">
              Demo role (display only)
            </p>
            <div className="grid grid-cols-3 gap-1">
              {ROLES.map(({ id, label, icon: Icon, description }) => {
                const active = role === id
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setRole(id)
                      clearStatus()
                    }}
                    title={description}
                    className={`group flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-center transition-all duration-300 ${
                      active
                        ? 'border border-white/20 bg-white/12 shadow-inner shadow-white/5'
                        : 'border border-transparent hover:bg-white/6'
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 transition-colors ${
                        active ? 'text-blue-300' : 'text-white/40 group-hover:text-white/60'
                      }`}
                      strokeWidth={1.75}
                    />
                    <span
                      className={`text-[11px] font-medium leading-tight ${
                        active ? 'text-white' : 'text-white/50 group-hover:text-white/70'
                      }`}
                    >
                      {label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="p-6">
            {/* Auth method tabs */}
            <div className="mb-6 flex rounded-xl border border-white/8 bg-black/20 p-1">
              {(
                [
                  { id: 'smart-id' as const, label: 'Smart-ID', icon: Fingerprint },
                  { id: 'mobile-id' as const, label: 'Mobile-ID', icon: Smartphone },
                ] as const
              ).map(({ id, label, icon: Icon }) => {
                const active = authMethod === id
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setAuthMethod(id)
                      clearStatus()
                    }}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-all duration-300 ${
                      active
                        ? 'bg-white/10 text-white shadow-sm'
                        : 'text-white/45 hover:text-white/70'
                    }`}
                  >
                    <Icon className="h-4 w-4" strokeWidth={1.75} />
                    {label}
                  </button>
                )
              })}
            </div>

            {/* Smart-ID form — mock only */}
            {authMethod === 'smart-id' && (
              <div className="space-y-4 animate-in fade-in duration-300">
                <div>
                  <label
                    htmlFor="isikukood"
                    className="mb-2 block text-xs font-medium text-white/50"
                  >
                    Isikukood (Personal Code)
                  </label>
                  <div className="relative">
                    <Fingerprint
                      className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25"
                      strokeWidth={1.75}
                    />
                    <input
                      id="isikukood"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="39001010000"
                      value={isikukood}
                      onChange={(e) => {
                        setIsikukood(formatIsikukood(e.target.value))
                        clearStatus()
                      }}
                      className="w-full rounded-xl border border-white/10 bg-white/5 py-3 pl-10 pr-4 text-sm text-white placeholder:text-white/20 outline-none transition focus:border-blue-400/40 focus:bg-white/8 focus:ring-2 focus:ring-blue-400/15"
                    />
                  </div>
                  <p className="mt-2 text-[11px] text-white/30">
                    Estonia&apos;s national identity — mock verification for demo (does not sign you in)
                  </p>
                </div>

                <button
                  type="button"
                  disabled={loading}
                  onClick={handleSmartId}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-linear-to-r from-blue-600 to-indigo-600 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/25 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Waiting for Smart-ID…
                    </>
                  ) : (
                    <>
                      <Fingerprint className="h-4 w-4" />
                      Continue with Smart-ID (Demo)
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Mobile-ID form — mock only */}
            {authMethod === 'mobile-id' && (
              <div className="space-y-4 animate-in fade-in duration-300">
                <div>
                  <label
                    htmlFor="phone"
                    className="mb-2 block text-xs font-medium text-white/50"
                  >
                    Mobile number
                  </label>
                  <div className="relative">
                    <Smartphone
                      className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25"
                      strokeWidth={1.75}
                    />
                    <input
                      id="phone"
                      type="tel"
                      autoComplete="tel"
                      placeholder="+372 5XXX XXXX"
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value)
                        clearStatus()
                      }}
                      className="w-full rounded-xl border border-white/10 bg-white/5 py-3 pl-10 pr-4 text-sm text-white placeholder:text-white/20 outline-none transition focus:border-blue-400/40 focus:bg-white/8 focus:ring-2 focus:ring-blue-400/15"
                    />
                  </div>
                  <p className="mt-2 text-[11px] text-white/30">
                    Mock Mobile-ID flow — does not create a real session
                  </p>
                </div>

                <button
                  type="button"
                  disabled={loading}
                  onClick={handleMobileId}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-linear-to-r from-blue-600 to-indigo-600 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/25 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Sending challenge…
                    </>
                  ) : (
                    <>
                      <Smartphone className="h-4 w-4" />
                      Continue with Mobile-ID (Demo)
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Divider */}
            <div className="my-6 flex items-center gap-3">
              <div className="h-px flex-1 bg-white/8" />
              <span className="text-[11px] font-medium uppercase tracking-widest text-white/25">
                or
              </span>
              <div className="h-px flex-1 bg-white/8" />
            </div>

            {/* Google OAuth — real Supabase Auth */}
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                void handleGoogle()
              }}
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-white/12 bg-white/8 py-3 text-sm font-medium text-white/90 backdrop-blur-sm transition hover:border-white/20 hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin text-white/60" />
              ) : (
                <GoogleIcon />
              )}
              Continue with Google
            </button>
            <p className="mt-2 text-center text-[11px] text-white/30">
              Real Supabase Auth (Google OAuth). Requires Google provider enabled in your project.
            </p>

            {/* Status messages */}
            {error && (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-400/20 bg-red-500/10 px-3.5 py-3 text-sm text-red-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {success && (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3.5 py-3 text-sm text-emerald-300">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{success}</span>
              </div>
            )}
          </div>
        </div>

        <p className="mt-6 text-center text-[11px] text-white/25">
          Smart-ID / Mobile-ID are demo-only · Dashboard requires a real Google sign-in session
        </p>
      </div>
    </div>
  )
}
