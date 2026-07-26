/**
 * Turnos da operação. É um CAMPO do cadastro (coluna `turno` em funcionarios),
 * editável em Configurar Horários — muda quando a pessoa troca de turno, sem
 * depender do horário de entrada.
 *
 * O horário de entrada só é usado como PALPITE inicial (corte às 11:00) para
 * cadastros antigos que ainda não tenham o campo preenchido.
 */
export const TURNOS = ['manha_tarde', 'tarde_noite'];

export const ROTULOS_TURNO = {
    manha_tarde: 'Manhã/Tarde',
    tarde_noite: 'Tarde/Noite'
};

/** Corte às 11:00: entra antes = Manhã/Tarde; às 11:00 ou depois = Tarde/Noite. */
export const HORA_CORTE_TURNO = 11;

const ORDEM_DIAS = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

/** Palpite a partir da jornada — usado só quando o funcionário ainda não tem turno salvo. */
export function turnoSugeridoPelaJornada(jornada) {
    if (!jornada) return 'manha_tarde';
    const primeiroDiaUtil = ORDEM_DIAS.find((d) => jornada[d] && jornada[d].trabalha);
    if (!primeiroDiaUtil) return 'manha_tarde';

    const hora = Number((jornada[primeiroDiaUtil].horario_entrada || '').split(':')[0]);
    if (!Number.isFinite(hora)) return 'manha_tarde';
    return hora >= HORA_CORTE_TURNO ? 'tarde_noite' : 'manha_tarde';
}

/** Turno efetivo de um funcionário: o campo salvo; se não houver, o palpite da jornada. */
export function turnoDoFuncionario(funcionario) {
    if (!funcionario) return null;
    if (TURNOS.includes(funcionario.turno)) return funcionario.turno;
    return turnoSugeridoPelaJornada(funcionario.jornada);
}

/** Monta { [funcionarioId]: turno } a partir da lista completa de funcionários. */
export function mapaDeTurnos(funcionarios) {
    const mapa = {};
    (funcionarios || []).forEach((f) => { mapa[f.id] = turnoDoFuncionario(f); });
    return mapa;
}
