import { AlertCircle, AlertTriangle, Info, Moon, Sun } from 'lucide-react';
import { cn } from '../utils/cn';

// High-contrast monochrome action, with indigo reserved for selected/active state.
const buttonBase =
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition duration-150 ease-out active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-50 dark:focus-visible:ring-offset-zinc-950';

const buttonVariants = {
  primary:
    'bg-zinc-900 text-zinc-50 shadow-card hover:bg-zinc-800 active:bg-zinc-950 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:active:bg-zinc-300',
  secondary:
    'border border-zinc-200/80 bg-white text-zinc-700 shadow-card hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/80 dark:hover:text-zinc-50',
  ghost:
    'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/80 dark:hover:text-zinc-100',
  danger:
    'text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300',
  subtle:
    'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700',
  onDark:
    'border border-white/10 bg-white/[0.06] text-zinc-200 hover:border-white/20 hover:bg-white/[0.1] hover:text-white active:bg-white/[0.14]',
};

const buttonSizes = {
  xs: 'h-7 px-2 text-2xs',
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-3.5 py-1.5 text-sm',
  icon: 'h-9 w-9',
  'icon-sm': 'h-8 w-8',
};

export function Button({ variant = 'primary', size = 'md', className, type = 'button', ...props }) {
  return (
    <button
      type={type}
      className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)}
      {...props}
    />
  );
}

const badgeTones = {
  neutral:
    'border-zinc-200/80 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-400',
  accent:
    'border-indigo-200/80 bg-indigo-50 text-indigo-700 dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-300',
  success:
    'border-emerald-200/80 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-400',
  warning:
    'border-amber-200/80 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-400',
  danger:
    'border-red-200/80 bg-red-50 text-red-600 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400',
};

const dotTones = {
  neutral: 'bg-zinc-400',
  accent: 'bg-indigo-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
};

export function Badge({ tone = 'neutral', dot = false, className, children, ...props }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-2xs font-medium',
        badgeTones[tone],
        className,
      )}
      {...props}
    >
      {dot ? <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dotTones[tone])} /> : null}
      {children}
    </span>
  );
}

const avatarSizes = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-7 w-7 text-2xs',
  md: 'h-8 w-8 text-xs',
  lg: 'h-9 w-9 text-sm',
};

export function Avatar({ name = 'Guest', size = 'md', className }) {
  const initial = (name || 'G').trim().charAt(0).toUpperCase() || 'G';

  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full border border-zinc-200/80 bg-zinc-100 font-medium text-zinc-600 dark:border-zinc-700/60 dark:bg-zinc-800 dark:text-zinc-300',
        avatarSizes[size],
        className,
      )}
    >
      {initial}
    </span>
  );
}

export function Panel({ className, children, ...props }) {
  return (
    <section
      className={cn(
        'rounded-lg border border-zinc-200/80 bg-white shadow-card dark:border-zinc-800 dark:bg-zinc-900',
        className,
      )}
      {...props}
    >
      {children}
    </section>
  );
}

export function PanelHeader({ title, meta, actions, className }) {
  return (
    <div
      className={cn(
        'flex min-h-12 items-center justify-between gap-3 border-b border-zinc-200/80 px-4 py-2.5 dark:border-zinc-800',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="truncate text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          {title}
        </h2>
        {meta}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

const calloutTones = {
  info: {
    wrapper:
      'border-zinc-200/80 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-400',
    icon: 'text-zinc-400 dark:text-zinc-500',
    Icon: Info,
  },
  warning: {
    wrapper:
      'border-amber-200/80 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300',
    icon: 'text-amber-500 dark:text-amber-400',
    Icon: AlertTriangle,
  },
  danger: {
    wrapper:
      'border-red-200/80 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300',
    icon: 'text-red-500 dark:text-red-400',
    Icon: AlertCircle,
  },
};

export function Callout({ tone = 'info', title, children, action, className }) {
  const { wrapper, icon, Icon } = calloutTones[tone] ?? calloutTones.info;

  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-md border px-3 py-2 text-xs leading-5',
        wrapper,
        className,
      )}
    >
      <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', icon)} strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={cn(title && 'mt-0.5 opacity-90')}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }) {
  return <div aria-hidden="true" className={cn('skeleton rounded-md', className)} />;
}

export function EmptyState({ icon: Icon, title, description, action, className, compact = false }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 px-4 py-6' : 'gap-3 px-6 py-10',
        className,
      )}
    >
      {Icon ? (
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200/80 bg-zinc-50 text-zinc-400 shadow-card dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-500">
          <Icon className="h-5 w-5" strokeWidth={1.5} />
        </div>
      ) : null}
      <div className="max-w-xs">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{title}</p>
        {description ? (
          <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function Switch({ id, checked, onChange, label, description, disabled = false }) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'group flex select-none items-start gap-3',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      )}
    >
      <span className="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          className="peer sr-only"
        />
        <span className="h-5 w-9 rounded-full border border-zinc-300 bg-zinc-200 transition-colors duration-150 ease-out group-hover:bg-zinc-300 peer-checked:border-indigo-600 peer-checked:bg-indigo-600 peer-focus-visible:ring-2 peer-focus-visible:ring-zinc-400 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-white dark:border-zinc-700 dark:bg-zinc-800 dark:group-hover:bg-zinc-700 dark:peer-checked:border-indigo-500 dark:peer-checked:bg-indigo-500 dark:peer-focus-visible:ring-offset-zinc-950" />
        <span className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150 ease-out peer-checked:translate-x-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-2xs leading-4 text-zinc-500 dark:text-zinc-400">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}

export function Field({ label, htmlFor, hint, children, className }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p> : null}
    </div>
  );
}

export const inputClass =
  'h-9 w-full rounded-md border border-zinc-200/80 bg-white px-3 py-1.5 text-sm text-zinc-900 shadow-card outline-none transition duration-150 ease-out placeholder:text-zinc-500 hover:border-zinc-300 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400/25 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:hover:border-zinc-700 dark:focus:border-zinc-600 dark:focus:ring-zinc-500/20 dark:disabled:bg-zinc-900';

export const textareaClass =
  'w-full resize-none rounded-md border border-zinc-200/80 bg-white px-3 py-2 text-sm leading-5 text-zinc-900 shadow-card outline-none transition duration-150 ease-out placeholder:text-zinc-500 hover:border-zinc-300 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400/25 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:hover:border-zinc-700 dark:focus:border-zinc-600 dark:focus:ring-zinc-500/20';

export function ThemeToggle({ theme, onToggle, className }) {
  const isDark = theme === 'dark';

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onToggle}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      className={className}
    >
      {isDark ? (
        <Sun className="h-4 w-4" strokeWidth={1.75} />
      ) : (
        <Moon className="h-4 w-4" strokeWidth={1.75} />
      )}
    </Button>
  );
}
