interface Props {
  stage: string;
  progress: number;
}

export function ProgressBar({ stage, progress }: Props) {
  const pct = Math.round(progress * 100);

  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          color: "#6b7280",
          marginBottom: 4,
        }}
      >
        <span>{stage}</span>
        <span>{pct}%</span>
      </div>
      <div
        style={{
          height: 6,
          background: "#e5e7eb",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: "#2563eb",
            borderRadius: 3,
            transition: "width 0.3s ease",
          }}
        />
      </div>
    </div>
  );
}
