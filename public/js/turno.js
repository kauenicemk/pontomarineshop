/**
 * Turno — DERIVADO automaticamente do horário de entrada da jornada. Não é um campo
 * do cadastro: existe só para exibição (selo na lista) e para filtrar telas.
 *
 * Foi resolvido assim de propósito: não exige coluna no banco, não exige migração,
 * não exige recadastrar ninguém e nunca fica dessincronizado do horário real —
 * mudou o horário de entrada, o turno acompanha sozinho.
 *
 * Regra: entrada antes das 11:00 = Manhã/Tarde | 11:00 ou depois = Tarde/Noite.
 */
export const TURNOS = ['manha_tarde', 'tarde_noite'];

export const ROTULOS_TURNO = {
    manha_tarde: 'Manhã/Tarde',
    tarde_noite: 'Tarde/Noite'
};

export const HORA_CORTE_TURNO = 11;

const ORDEM_DIAS = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

/** Turno a partir da jornada (usa o primeiro dia da semana em que a pessoa trabalha). */
export function turnoDaJornada(jornada) {
    if (!jornada) return 'manha_tarde';
    const primeiroDiaUtil = ORDEM_DIAS.find((d) => jornada[d] && jornada[d].trabalha);
    if (!primeiroDiaUtil) return 'manha_tarde';

    const hora = Number((jornada[primeiroDiaUtil].horario_entrada || '').split(':')[0]);
    if (!Number.isFinite(hora)) return 'manha_tarde';
    return hora >= HORA_CORTE_TURNO ? 'tarde_noite' : 'manha_tarde';
}

/** Turno de um funcionário (objeto com `jornada`). */
export function turnoDoFuncionario(funcionario) {
    if (!funcionario) return 'manha_tarde';
    return turnoDaJornada(funcionario.jornada);
}

/** Monta { [funcionarioId]: turno } a partir da lista completa de funcionários. */
export function mapaDeTurnos(funcionarios) {
    const mapa = {};
    (funcionarios || []).forEach((f) => { mapa[f.id] = turnoDoFuncionario(f); });
    return mapa;
}
