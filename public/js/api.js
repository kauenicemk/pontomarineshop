import { getAdminToken, getTotemToken, limparAdminToken } from './auth.js';
import { toast } from './toast.js';

let avisoSessaoExibido = false;

class ApiError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

/**
 * Wrapper único de fetch. `admin: true` manda o token de sessão do administrador (Bearer);
 * `totem: true` manda o token do dispositivo (x-totem-token). O backend SEMPRE confere de
 * novo (ver src/middleware/adminAuth.js e totemAuth.js) — nunca é só decoração de tela.
 */
async function chamar(caminho, { method = 'GET', body, admin = false, totem = false } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (admin) {
        const token = getAdminToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
    }
    if (totem) {
        const token = getTotemToken();
        if (token) headers['x-totem-token'] = token;
    }

    let res;
    try {
        res = await fetch(caminho, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined
        });
    } catch (_) {
        // Falha de rede (sem internet, servidor fora) — mensagem clara em vez de "Failed to fetch".
        throw new ApiError('Sem conexão com o servidor. Verifique a internet e tente novamente.', 0);
    }

    let data = null;
    try { data = await res.json(); } catch (_) { /* resposta sem corpo JSON */ }

    if (!res.ok) {
        // Sessão do administrador expirada/inválida: em vez de cada clique falhar com um
        // erro genérico, avisa uma única vez e volta pra tela de login.
        if (res.status === 401 && admin && getAdminToken()) {
            limparAdminToken();
            if (!avisoSessaoExibido) {
                avisoSessaoExibido = true;
                toast('Sua sessão expirou. Faça login novamente.', 'erro');
                setTimeout(() => window.location.reload(), 1500);
            }
        }
        throw new ApiError((data && data.message) || `Erro ${res.status}`, res.status);
    }
    return data;
}

export const api = {
    // Funcionários
    listarFuncionarios: () => chamar('/api/funcionarios', { totem: true }),
    listarFuncionariosTodos: () => chamar('/api/funcionarios/todos', { admin: true }),
    criarFuncionario: (dados) => chamar('/api/funcionarios', { method: 'POST', body: dados, admin: true }),
    atualizarRegrasAlmoco: (id, dados) => chamar(`/api/funcionarios/${id}/regras-almoco`, { method: 'POST', body: dados, admin: true }),
    atualizarAtivo: (id, ativo) => chamar(`/api/funcionarios/${id}/ativo`, { method: 'POST', body: { ativo }, admin: true }),
    atualizarRegime: (id, regime) => chamar(`/api/funcionarios/${id}/regime`, { method: 'POST', body: { regime }, admin: true }),
    removerFuncionario: (id) => chamar(`/api/funcionarios/${id}`, { method: 'DELETE', admin: true }),
    salvarJornada: (id, jornada) => chamar(`/api/funcionarios/${id}/jornada`, { method: 'POST', body: jornada, admin: true }),
    cadastrarBiometria: (id, descritor) => chamar(`/api/funcionarios/${id}/biometria`, { method: 'POST', body: { descritor }, admin: true }),
    removerBiometria: (id) => chamar(`/api/funcionarios/${id}/biometria`, { method: 'DELETE', admin: true }),
    resumoBiometria: () => chamar('/api/funcionarios/biometria/resumo', { admin: true }),
    atualizarDadosCadastrais: (id, dados) => chamar(`/api/funcionarios/${id}/dados-cadastrais`, { method: 'POST', body: dados, admin: true }),

    // Ponto (totem)
    baterPonto: (funcionario_id, tipo) => chamar('/api/ponto', { method: 'POST', body: { funcionario_id, tipo }, totem: true }),
    reconhecerRosto: (descritor) => chamar('/api/reconhecer-rosto', { method: 'POST', body: { descritor }, totem: true }),
    meuHistorico: (id) => chamar(`/api/meu-historico/${id}`, { totem: true }),
    verificarPin: (id, pin) => chamar(`/api/funcionarios/${id}/verificar-pin`, { method: 'POST', body: { pin }, totem: true }),

    // Ponto (admin)
    ajustarPonto: (dados) => chamar('/api/ajuste-ponto', { method: 'POST', body: dados, admin: true }),
    pontosDoDia: (funcionarioId, data) => chamar(`/api/pontos-do-dia?${new URLSearchParams({ funcionario_id: funcionarioId, data })}`, { admin: true }),
    editarPonto: (id, dados) => chamar(`/api/ponto/${id}`, { method: 'PUT', body: dados, admin: true }),
    removerPonto: (id, justificativa) => chamar(`/api/ponto/${id}`, { method: 'DELETE', body: { justificativa }, admin: true }),
    historicoGeral: (inicio, fim) => chamar(`/api/historico-geral?${new URLSearchParams({ inicio: inicio || '', fim: fim || '' })}`, { admin: true }),
    pendencias: () => chamar('/api/pendencias', { admin: true }),
    resumoDoDia: () => chamar('/api/dashboard-resumo', { admin: true }),

    // Relatórios
    relatorioCalculado: (inicio, fim) => chamar(`/api/relatorio-calculado?${new URLSearchParams({ inicio: inicio || '', fim: fim || '' })}`, { admin: true }),
    relatorioIndividual: (id, inicio, fim) => chamar(`/api/relatorio-individual/${id}?${new URLSearchParams({ inicio, fim })}`, { admin: true }),
    meuRelatorioIndividual: (id, inicio, fim) => chamar(`/api/meu-relatorio/${id}?${new URLSearchParams({ inicio, fim })}`, { totem: true }),

    // Feriados
    listarFeriados: () => chamar('/api/feriados'),
    criarFeriado: (dados) => chamar('/api/feriados', { method: 'POST', body: dados, admin: true }),
    removerFeriado: (id) => chamar(`/api/feriados/${id}`, { method: 'DELETE', admin: true }),

    // Ausências / faltas
    calcularFaltas: (inicio, fim) => chamar(`/api/ausencias/faltas?${new URLSearchParams({ inicio, fim })}`, { admin: true }),
    justificarAusencia: (dados) => chamar('/api/ausencias', { method: 'POST', body: dados, admin: true }),
    justificarAusenciasEmLote: (dados) => chamar('/api/ausencias/lote', { method: 'POST', body: dados, admin: true }),

    // Administração geral
    zerarDados: (confirmacao) => chamar('/api/admin/zerar-dados', { method: 'POST', body: { confirmacao }, admin: true }),
    listarAuditoria: (filtros) => chamar(`/api/admin/auditoria?${new URLSearchParams(filtros)}`, { admin: true }),
    listarAcoesAuditoria: () => chamar('/api/admin/auditoria/acoes', { admin: true }),
    listarConfigHorasExtras: () => chamar('/api/admin/horas-extras/config', { admin: true }),
    salvarConfigHorasExtras: (tipo, percentual) => chamar('/api/admin/horas-extras/config', { method: 'POST', body: { tipo, percentual }, admin: true }),
    criarAdmin: (dados) => chamar('/api/auth/admin/criar', { method: 'POST', body: dados, admin: true }),
    listarAdmins: () => chamar('/api/auth/admin/listar', { admin: true }),
    removerAdmin: (id) => chamar(`/api/auth/admin/${id}`, { method: 'DELETE', admin: true }),
    trocarSenhaTotem: (nova_senha) => chamar('/api/auth/totem/trocar-senha', { method: 'POST', body: { nova_senha }, admin: true }),

    // Férias (simplificada)
    listarFerias: () => chamar('/api/ferias', { admin: true }),
    feriasAgora: () => chamar('/api/ferias/agora', { admin: true }),
    registrarFerias: (dados) => chamar('/api/ferias', { method: 'POST', body: dados, admin: true }),
    removerFerias: (id) => chamar(`/api/ferias/${id}`, { method: 'DELETE', admin: true }),

    // Espelho de ponto — a consulta manda os dois tokens (o que existir no contexto):
    // no totem vai o do dispositivo; no painel administrativo vai o Bearer do admin.
    buscarConfirmacaoEspelho: (funcionarioId, mes) => chamar(`/api/espelho/confirmacao/${funcionarioId}?mes=${mes}`, { totem: true, admin: true }),
    confirmarEspelho: (funcionario_id, mes_referencia) => chamar('/api/espelho/confirmar', { method: 'POST', body: { funcionario_id, mes_referencia }, totem: true }),

    // People Analytics
    indicadoresGerais: (inicio, fim) => chamar(`/api/analytics/indicadores?${new URLSearchParams({ inicio, fim })}`, { admin: true })
};

export { ApiError };
