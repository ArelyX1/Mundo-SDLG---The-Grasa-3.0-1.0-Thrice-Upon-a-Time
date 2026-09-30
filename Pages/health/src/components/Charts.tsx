import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const RED = '#d02a2a';
const RED_SOFT = '#7a1c1c';
const WHITE = '#f2f0ec';
const GREY = '#8a8580';

export const axis = {
  stroke: GREY,
  fontSize: 11,
  tickLine: false,
} as const;

export const grid = {
  stroke: '#2a2622',
  strokeDasharray: '3 3',
} as const;

const tooltipStyle = {
  backgroundColor: '#12100e',
  border: `1px solid ${RED_SOFT}`,
  color: WHITE,
  fontSize: 12,
  borderRadius: 2,
} as const;

const legendStyle = { color: GREY, fontSize: 11 } as const;

/** Latencia del RPC. Es la señal más directa de si el nodo responde bien. */
export function LatencyChart({ data }: { data: { t: string; latency: number | null }[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data}>
        <CartesianGrid {...grid} vertical={false} />
        <XAxis dataKey="t" {...axis} minTickGap={40} />
        <YAxis {...axis} unit=" ms" width={56} />
        <Tooltip contentStyle={tooltipStyle} />
        <ReferenceLine y={0} stroke={RED} strokeDasharray="2 4" />
        <Line
          type="monotone"
          dataKey="latency"
          stroke={RED}
          strokeWidth={2}
          dot={false}
          connectNulls
          isAnimationActive={false}
          name="latencia"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Altura de bloque. Si la línea se aplana, la cadena está parada. */
export function BlockHeightChart({ data }: { data: { t: string; height: number | null }[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="blocks" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={RED} stopOpacity={0.55} />
            <stop offset="100%" stopColor={RED} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid {...grid} vertical={false} />
        <XAxis dataKey="t" {...axis} minTickGap={40} />
        <YAxis {...axis} width={62} domain={['auto', 'auto']} />
        <Tooltip contentStyle={tooltipStyle} />
        <Area
          type="monotone"
          dataKey="height"
          stroke={RED}
          strokeWidth={2}
          fill="url(#blocks)"
          isAnimationActive={false}
          name="altura"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Oferta y máximo en la misma escala, para ver cuánto queda por emitir. */
export function SupplyChart({
  data,
  maxSupply,
}: {
  data: { t: string; supply: number | null }[];
  maxSupply: number | null;
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data}>
        <CartesianGrid {...grid} vertical={false} />
        <XAxis dataKey="t" {...axis} minTickGap={40} />
        <YAxis {...axis} width={68} domain={[0, maxSupply ?? 'auto']} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => v.toLocaleString('es')} />
        <Area
          type="monotone"
          dataKey="supply"
          stroke={WHITE}
          strokeWidth={2}
          fill={RED}
          fillOpacity={0.35}
          isAnimationActive={false}
          name="oferta"
        />
        {maxSupply !== null && (
          <ReferenceLine
            y={maxSupply}
            stroke={RED}
            strokeDasharray="4 4"
            label={{ value: 'máximo', fill: GREY, fontSize: 10, position: 'insideTopRight' }}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Bytes y entradas de almacenamiento, en dos escalas, porque no comparten magnitud. */
export function StorageChart({ data }: { data: { t: string; items: number | null; octets: number | null }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data}>
        <CartesianGrid {...grid} vertical={false} />
        <XAxis dataKey="t" {...axis} minTickGap={40} />
        <YAxis yAxisId="l" {...axis} width={54} />
        <YAxis yAxisId="r" orientation="right" {...axis} width={62} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend {...legendStyle} />
        <Bar yAxisId="l" dataKey="items" fill={RED} isAnimationActive={false} name="entradas" />
        <Line
          yAxisId="r"
          type="monotone"
          dataKey="octets"
          stroke={WHITE}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
          name="bytes"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/**
 * Composición de un instante, en reancla. Los cinco valores nunca suman el mismo
 * total, así que el radar se lee por forma y no por área.
 */
export function StateRadar({ snapshot }: { snapshot: Record<string, number> }) {
  const data = Object.entries(snapshot).map(([axisName, value]) => ({ axisName, value }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <RadarChart data={data}>
        <PolarGrid stroke="#2a2622" />
        <PolarAngleAxis dataKey="axisName" tick={{ fill: GREY, fontSize: 10 }} />
        <PolarRadiusAxis tick={{ fill: GREY, fontSize: 9 }} axisLine={false} />
        <Radar dataKey="value" stroke={RED} fill={RED} fillOpacity={0.4} isAnimationActive={false} />
        <Tooltip contentStyle={tooltipStyle} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

/** Reparto de la actividad: extrinsics frente a trabajo pendiente. */
export function QueuePie({ pending, slots }: { pending: number | null; slots: number | null }) {
  const pendingN = pending ?? 0;
  const free = Math.max(0, (slots ?? 16) - pendingN);
  const data = [
    { name: 'pendiente', value: pendingN },
    { name: 'libre', value: free },
  ];
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={48}
          outerRadius={78}
          isAnimationActive={false}
          label={({ name, value }) => `${name} ${value}`}
          labelLine={false}
        >
          <Cell fill={RED} />
          <Cell fill={RED_SOFT} />
        </Pie>
        <Tooltip contentStyle={tooltipStyle} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Latencia contra altura: cada punto es un sondeo, y los clusters delatan periodos malos. */
export function LatencyScatter({
  data,
}: {
  data: { block: number; latency: number | null }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ScatterChart margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
        <CartesianGrid {...grid} />
        <XAxis type="number" dataKey="block" {...axis} domain={['dataMin', 'dataMax']} />
        <YAxis type="number" dataKey="latency" {...axis} unit=" ms" width={56} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ strokeDasharray: '3 3' }} />
        <Scatter data={data} fill={RED} isAnimationActive={false} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

/** Salud por sondeo, apilado, para ver dónde se cae sin leer la línea entera. */
export function UptimeStack({
  data,
}: {
  data: { t: string; ok: number; ko: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={90}>
      <BarChart data={data} barCategoryGap={0}>
        <XAxis dataKey="t" {...axis} minTickGap={30} hide />
        <Tooltip contentStyle={tooltipStyle} />
        <Bar dataKey="ok" stackId="s" fill={RED} isAnimationActive={false} name="respondió" />
        <Bar dataKey="ko" stackId="s" fill="#2a2622" isAnimationActive={false} name="falló" />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Slots y epoch van en escalas distintas y crecen sin parar, así que se
 * separan: slots en el eje izquierdo, epoch en el derecho.
 */
export function SlotEpochChart({
  data,
}: {
  data: { t: string; slot: number | null; epoch: number | null }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <ComposedChart data={data}>
        <CartesianGrid {...grid} vertical={false} />
        <XAxis dataKey="t" {...axis} minTickGap={40} />
        <YAxis yAxisId="slot" {...axis} width={70} domain={['dataMin', 'dataMax']} />
        <YAxis yAxisId="epoch" orientation="right" {...axis} width={54} domain={['dataMin', 'dataMax']} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend {...legendStyle} />
        <Line
          yAxisId="slot"
          type="stepAfter"
          dataKey="slot"
          stroke={RED}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
          name="slot"
        />
        <Line
          yAxisId="epoch"
          type="stepAfter"
          dataKey="epoch"
          stroke={WHITE}
          strokeWidth={1}
          strokeDasharray="4 3"
          dot={false}
          isAnimationActive={false}
          name="epoch"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Barras horizontales para los pares clave/valor que no son serie temporal. */
export function MetricBars({
  data,
}: {
  data: { label: string; value: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 34)}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 16 }}>
        <CartesianGrid {...grid} horizontal={false} />
        <XAxis type="number" {...axis} />
        <YAxis type="category" dataKey="label" {...axis} width={104} />
        <Tooltip contentStyle={tooltipStyle} />
        <Bar dataKey="value" fill={RED} isAnimationActive={false} radius={[0, 0, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Una línea y nada más, para meter en una tarjeta estrecha. */
export function Sparkline({
  data,
  dataKey,
  color = RED,
}: {
  data: Record<string, number | null>[];
  dataKey: string;
  color?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={44}>
      <LineChart data={data}>
        <Line
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
