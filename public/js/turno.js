/**
 * Turno (manhã / tarde / noite) — DERIVADO do horário de entrada que já existe na
 * jornada de cada funcionário. Foi resolvido assim de propósito: não exige coluna
 * nova no banco, não exige recadastrar ninguém e nunca fica dessincronizado do
 * horário real. Se um dia a empresa precisar de turnos que NÃO seguem o horário de
 * entrada (ex.: escalas 12x36 com nomes próprios), aí sim vale um campo dedicado.
 *
 * Faixas: entrada antes das 12h = manhã | 12h–17h59 = tarde | 18h em diante = noite.
 */
const ORDEM_DIAS = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

export const ROTULOS_TURNO = { manha: 'Manhã', tarde: 'Tarde', noite: 'Noite' };

/** Recebe a jornada ({segunda: {...}, ...}) e devolve 'manha' | 'tarde' | 'noite' | null. */
export function turnoDaJornada(jornada) {
    if (!jornada) return null;
    const primeiroDiaUtil = ORDEM_DIAS.find((d) => jornada[d] && jornada[d].trabalha);
    if (!primeiroDiaUtil) return null;

    const entrada = jornada[primeiroDiaUtil].horario_entrada || '';
    const hora = Number(entrada.split(':')[0]);
    if (!Number.isFinite(hora)) return null;

    if (hora < 12) return 'manha';
    if (hora < 18) return 'tarde';
    return 'noite';
}

/** Monta { [funcionarioId]: 'manha'|'tarde'|'noite'|null } a partir da lista completa de funcionários. */
export function mapaDeTurnos(funcionarios) {
    const mapa = {};
    (funcionarios || []).forEach((f) => { mapa[f.id] = turnoDaJornada(f.jornada); });
    return mapa;
}
