export default function EmptyState({ icon: Icon, title, hint, action }) {
  return (
    <div className="card p-10 text-center">
      {Icon && <Icon size={28} className="mx-auto text-neutral-600 mb-3" />}
      <h3 className="font-medium text-neutral-200">{title}</h3>
      {hint && <p className="text-sm text-neutral-500 mt-1 max-w-md mx-auto">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
