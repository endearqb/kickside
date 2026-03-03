type DiagnosticItemProps = {
  label: string;
  value: string;
};

export function DiagnosticItem({ label, value }: DiagnosticItemProps) {
  return (
    <div className="diag-item">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
