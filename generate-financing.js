/**
 * Genera planes-financiacion.xlsx con cuotas calculadas en sistema francés.
 * Ejecutar una sola vez (o cada vez que cambien los datos): node generate-financing.js
 */
import { utils, write } from 'xlsx';
import { writeFileSync } from 'fs';

// Sistema Francés: PMT = P * [r(1+r)^n] / [(1+r)^n - 1]
function pmt(annualRate, months, principal) {
  const r = annualRate / 12;
  if (r === 0) return Math.round(principal / months);
  const factor = Math.pow(1 + r, months);
  return Math.round(principal * r * factor / (factor - 1));
}

const TNA70 = 0.70;
const TNA35 = 0.35;

const PLANTA_BAJA = [
  { nombre: '15 m²',  precio: 4_650_000 },
  { nombre: '18 m²',  precio: 5_580_000 },
  { nombre: '21 m²',  precio: 6_510_000 },
  { nombre: '30 m²',  precio: 9_300_000 },
  { nombre: '33 m²',  precio: 10_230_000 },
  { nombre: '36 m²',  precio: 11_160_000 },
  { nombre: '40 m²',  precio: 12_400_000 },
  { nombre: '47 m²',  precio: 14_570_000 },
  { nombre: '51 m²',  precio: 15_810_000 },
  { nombre: '54 m²',  precio: 16_740_000 },
  { nombre: '67 m²',  precio: 20_770_000 },
  { nombre: '80 m²',  precio: 24_800_000 },
  { nombre: '103 m²', precio: 31_930_000 },
];

const DOS_PLANTAS = [
  { nombre: 'Dúplex 30 m²', precio: 11_400_000 },
  { nombre: 'Dúplex 40 m²', precio: 15_200_000 },
  { nombre: 'Dúplex 54 m²', precio: 20_520_000 },
];

const CABANAS = [
  { nombre: 'Cabaña 25 m²', precio: 9_500_000 },
  { nombre: 'Cabaña 47 m²', precio: 17_860_000 },
  { nombre: 'Cabaña 67 m²', precio: 25_460_000 },
];

function buildRows(models) {
  return models.map(({ nombre, precio }) => {
    const anticipo = Math.round(precio * 0.60);
    const saldo    = Math.round(precio * 0.40);
    return {
      'Modelo':                    nombre,
      'Precio Contado ($)':        precio,
      'Anticipo 60% ($)':          anticipo,
      'Saldo Financiado 40% ($)':  saldo,
      'Cuota 12m TNA 70% ($)':     pmt(TNA70, 12, saldo),
      'Cuota 24m TNA 70% ($)':     pmt(TNA70, 24, saldo),
      'Cuota 36m TNA 70% ($)':     pmt(TNA70, 36, saldo),
      'Cuota 12m CAC 35% ($)':     pmt(TNA35, 12, saldo),
      'Cuota 24m CAC 35% ($)':     pmt(TNA35, 24, saldo),
      'Cuota 36m CAC 35% ($)':     pmt(TNA35, 36, saldo),
    };
  });
}

const COL_WIDTHS = [16, 20, 18, 22, 22, 22, 22, 22, 22, 22];

function makeSheet(rows) {
  const ws = utils.json_to_sheet(rows);
  ws['!cols'] = COL_WIDTHS.map(wch => ({ wch }));
  return ws;
}

const CONDITIONS = [
  { 'Condición': 'Precio de lista',    'Detalle': 'Precio contado, sin financiación' },
  { 'Condición': 'Anticipo',           'Detalle': '60% del precio de lista al inicio de obra' },
  { 'Condición': 'Saldo financiado',   'Detalle': '40% del precio de lista' },
  { 'Condición': 'Plan TNA 70% fijo',  'Detalle': 'Sistema francés, tasa fija 70% TNA en pesos. Cuota igual todos los meses.' },
  { 'Condición': 'Plan CAC 35%',       'Detalle': 'Sistema francés, tasa real 35% TNA + ajuste por índice CAC (Cámara Argentina de Construcción) mensual.' },
  { 'Condición': 'Plazos disponibles', 'Detalle': '12, 24 o 36 cuotas mensuales' },
  { 'Condición': 'Nota',               'Detalle': 'Valores orientativos. El presupuesto definitivo y condiciones exactas las confirma el equipo comercial.' },
];

const wb = utils.book_new();
utils.book_append_sheet(wb, makeSheet(buildRows(PLANTA_BAJA)), 'Planta Baja');
utils.book_append_sheet(wb, makeSheet(buildRows(DOS_PLANTAS)),  'Dos Plantas');
utils.book_append_sheet(wb, makeSheet(buildRows(CABANAS)),      'Cabañas');
utils.book_append_sheet(wb, utils.json_to_sheet(CONDITIONS),   'Condiciones');

writeFileSync('planes-financiacion.xlsx', write(wb, { type: 'buffer', bookType: 'xlsx' }));
console.log('planes-financiacion.xlsx generado OK');

// Preview en consola
console.log('\n--- PLANTA BAJA (primeras 3 filas) ---');
buildRows(PLANTA_BAJA).slice(0, 3).forEach(r => {
  console.log(
    `${r['Modelo'].padEnd(10)} | contado: $${r['Precio Contado ($)'].toLocaleString('es-AR')}` +
    ` | anticipo: $${r['Anticipo 60% ($)'].toLocaleString('es-AR')}` +
    ` | saldo: $${r['Saldo Financiado 40% ($)'].toLocaleString('es-AR')}` +
    ` | 12m@70%: $${r['Cuota 12m TNA 70% ($)'].toLocaleString('es-AR')}` +
    ` | 24m@70%: $${r['Cuota 24m TNA 70% ($)'].toLocaleString('es-AR')}` +
    ` | 36m@70%: $${r['Cuota 36m TNA 70% ($)'].toLocaleString('es-AR')}` +
    ` | 12m@35%: $${r['Cuota 12m CAC 35% ($)'].toLocaleString('es-AR')}` +
    ` | 24m@35%: $${r['Cuota 24m CAC 35% ($)'].toLocaleString('es-AR')}` +
    ` | 36m@35%: $${r['Cuota 36m CAC 35% ($)'].toLocaleString('es-AR')}`
  );
});
