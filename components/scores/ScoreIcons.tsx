/** Le icone dei bonus e dei malus, tutte con lo stesso tratto. Il colore lo dà chi le usa. */

export type ScoreIconKind =
  | "goal"
  | "penalty"
  | "assist"
  | "yellow"
  | "red"
  | "own"
  | "miss"
  | "save"
  | "conceded"
  | "clean"
  | "captain"
  | "double"
  | "political"
  | "defense"
  | "fairplay"
  | "empty"
  | "in"
  | "out"
  | "players";

const LINE = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function Ball({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <>
      <circle cx={x} cy={y} r={r} {...LINE} />
      <circle cx={x} cy={y} r={r * 0.36} fill="currentColor" />
    </>
  );
}

/** La porta vista di fronte. */
function Frame() {
  return <path d="M2.5 16V4.5h15V16" {...LINE} />;
}

function shape(kind: ScoreIconKind) {
  if (kind === "goal") {
    return (
      <>
        <circle cx="10" cy="10" r="7.4" {...LINE} />
        <path d="m10 6.6 3.2 2.3-1.2 3.8H8L6.8 8.900z" fill="currentColor" />
        <path d="M10 6.6V2.8M13.2 8.9l3.5-1.2M12 12.700l2.2 3M8 12.700l-2.2 3M6.800 8.9 3.300 7.7" {...LINE} strokeWidth={1.2} />
      </>
    );
  }
  if (kind === "penalty") return <><Frame /><Ball x={10} y={11} r={3.4} /></>;
  if (kind === "miss") return <><Frame /><path d="m7 8 6 6M13 8l-6 6" {...LINE} /></>;
  if (kind === "conceded") return <><Frame /><path d="M2.500 8.500h15M7 4.5V16M13 4.500V16" {...LINE} strokeWidth={0.9} opacity={0.55} /><Ball x={13} y={12.500} r={3} /></>;
  if (kind === "own") {
    return (
      <>
        <Ball x={10} y={11} r={4} />
        <path d="M4.2 9.200A6.200 6.200 0 0 1 14.6 5.4" {...LINE} />
        <path d="m14.800 2.300.2 3.600-3.5.3" {...LINE} />
      </>
    );
  }
  if (kind === "assist") {
    // Scarpino da calcio
    return (
      <>
        <path d="M3 5.500h4l1.800 3.600 5.400 1.500c1.800.5 2.8 1.500 2.800 3.1H3z" {...LINE} />
        <path d="M5 16.600v.4M9 16.600v.4M13 16.600v.4M10.500 8.2 9.200 9.600M12.600 9l-1.200 1.5" {...LINE} />
      </>
    );
  }
  if (kind === "yellow" || kind === "red") {
    return <rect x="5.5" y="3" width="9" height="13.500" rx="1.600" fill="currentColor" transform="rotate(8 10 10)" />;
  }
  if (kind === "save") {
    // Guantone del portiere
    return <path d="M6.500 17v-3.2L3.900 10.300c-.8-1.1.7-2.3 1.7-1.300L7 10.600V5a1.100 1.100 0 0 1 2.2 0v4-5.400a1.100 1.100 0 0 1 2.2 0V9 4.400a1.100 1.100 0 0 1 2.2 0V10V6.600a1.100 1.100 0 0 1 2.2 0V12c0 1.600-.5 2.8-1.600 3.700V17z" {...LINE} strokeWidth={1.4} />;
  }
  if (kind === "clean") {
    return (
      <>
        <path d="M10 2.600 16 5v5c0 3.600-2.5 6.1-6 7.500-3.5-1.400-6-3.900-6-7.500V5z" {...LINE} />
        <path d="m7 10 2.100 2.100L13.300 8" {...LINE} />
      </>
    );
  }
  if (kind === "defense") {
    return (
      <>
        <path d="M10 2.600 16 5v5c0 3.600-2.5 6.1-6 7.500-3.5-1.400-6-3.900-6-7.500V5z" {...LINE} />
        <path d="M4.500 8.200h11M5.200 12h9.600M10 4v4.200M7.500 8.200V12M12.500 8.200V12" {...LINE} strokeWidth={1.1} />
      </>
    );
  }
  if (kind === "captain" || kind === "double" || kind === "political") {
    const text = kind === "captain" ? "C" : kind === "double" ? "×2" : "6";
    return (
      <>
        <circle cx="10" cy="10" r="7.600" {...LINE} />
        <text x="10" y="13.400" textAnchor="middle" fontSize={kind === "double" ? 8.5 : 10} fontWeight="700" fill="currentColor">{text}</text>
      </>
    );
  }
  if (kind === "fairplay") {
    // Pollice su
    return <path d="M3.500 9h2.8v8H3.500zM6.300 15.800l1.700 1.200h6c.9 0 1.600-.6 1.800-1.4l1.2-5.1c.3-1.1-.6-2.2-1.7-2.2h-3.9l.6-3c.2-1.100-.6-2.100-1.7-2.100L6.300 9.400" {...LINE} />;
  }
  if (kind === "empty") {
    return (
      <>
        <circle cx="10" cy="10" r="7.400" {...LINE} strokeDasharray="2.600 2.6" />
        <path d="M7 10h6" {...LINE} />
      </>
    );
  }
  if (kind === "in") return <path d="M10 16V4.500M5.500 9 10 4.5 14.500 9" {...LINE} strokeWidth={2} />;
  if (kind === "out") return <path d="M10 4v11.500M5.500 11 10 15.500 14.500 11" {...LINE} strokeWidth={2} />;
  return (
    <>
      <circle cx="7.500" cy="7" r="2.800" {...LINE} />
      <path d="M2.800 16c.4-2.8 2.3-4.2 4.7-4.200s4.300 1.4 4.700 4.200M13 4.600a2.600 2.600 0 0 1 0 5M14.500 12.100c1.5.5 2.5 1.800 2.7 3.900" {...LINE} />
    </>
  );
}

export function ScoreIcon({ kind }: { kind: ScoreIconKind }) {
  return (
    <svg className={`score-icon score-${kind}`} viewBox="0 0 20 20" aria-hidden="true">
      {shape(kind)}
    </svg>
  );
}
