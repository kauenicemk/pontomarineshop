import * as authMod from './auth.js';
import { toast } from './toast.js';
import { hojeISO, comBotaoOcupado } from './utils.js';
import { montarLogos } from './brand.js';
import { aplicarTemaSalvo, montarAlternadores } from './tema.js';
import { api } from './api.js';
import { confirmar } from './confirmar.js';

import * as baterPonto from './tabs/baterPonto.js';
import * as historico from './tabs/historico.js';
import * as gestor from './tabs/gestor.js';
import * as config from './tabs/config.js';
import * as pendencias from './tabs/pendencias.js';
import * as bancoHoras from './tabs/bancoHoras.js';
import * as feriados from './tabs/feriados.js';
import * as faltas from './tabs/faltas.js';
import * as admin from './tabs/admin.js';
import * as biometria from './tabs/biometria.js';
import * as relatorioIndividual from './tabs/relatorioIndividual.js';
import * as ferias from './tabs/ferias.js';
import * as analytics from './tabs/analytics.js';
import * as espelho from './tabs/espelho.js';
import * as dashboard from './tabs/dashboard.js';
import * as auditoria from './tabs/auditoria.js';
import * as editorPontos from './tabs/editorPontos.js';
import * as atrasos from './tabs/atrasos.js';
import * as trocas from './tabs/trocas.js';
import * as escalaDia from './tabs/escalaDia.js';
import * as atestados from './tabs/atestados.js';

const ehModoAdmin = window.location.pathname.startsWith('/admin');

let intervaloPendencias = null;
let subAbaAdminAtual = 'dashboard';

/* ===================== Relógio (usado no totem) ===================== */

function iniciarRelogio() {
    const el = document.getElementById('relogio');
    const elData = document.getElementById('relogio-data');
    if (!el) return;
    function atualizar() {
        const agora = new Date();
        el.textContent = new Intl.DateTimeFormat('pt-BR', {
            timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit'
        }).format(agora);
        if (elData) {
            elData.textContent = new Intl.DateTimeFormat('pt-BR', {
                timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: 'long'
            }).format(agora);
        }
    }
    atualizar();
    setInterval(atualizar, 1000);
}

/* ===================== TOTEM ===================== */

async function recarregarFuncionariosDoTotem() {
    const funcionarios = await baterPonto.carregarMuralFuncionarios();
    historico.popularSeletor(funcionarios);
    return funcionarios;
}

function mudarTotemAba(nomeAba, botao) {
    document.querySelectorAll('.totem-tela').forEach((s) => s.classList.remove('ativa'));
    document.querySelectorAll('.totem-nav button').forEach((b) => b.classList.remove('ativo'));
    document.getElementById(`totem-${nomeAba}`).classList.add('ativa');
    if (botao) botao.classList.add('ativo');

    if (nomeAba !== 'bater-ponto') baterPonto.pararReconhecimentoFacial();
    else baterPonto.autoAbrirCamera();

    // Sair do "Meu Histórico" fecha o acesso: o próximo consulta pede o PIN de novo.
    if (nomeAba !== 'historico') historico.bloquearHistorico();
}

function iniciarNavegacaoTotem() {
    document.querySelectorAll('.totem-nav [data-totem-aba]').forEach((btn) => {
        btn.addEventListener('click', () => mudarTotemAba(btn.dataset.totemAba, btn));
    });
}

function iniciarBotoesTotem() {
    document.getElementById('btn-fechar-modal-ponto')?.addEventListener('click', () => {
        baterPonto.fecharModalSucesso();
    });
    baterPonto.iniciarBusca();
    baterPonto.iniciarBotoesDePonto();
    baterPonto.iniciarReconhecimentoFacial();
    espelho.iniciarEspelho();

    // Sair do totem — desautoriza este tablet e volta pra tela de senha.
    // Com confirmação: é uma ação rara (o totem fica logado por 90 dias) e desfazê-la
    // exige a senha do totem de novo.
    document.getElementById('btn-sair-totem')?.addEventListener('click', async () => {
        const ok = await confirmar(
            'Sair do totem?',
            'Este tablet vai voltar para a tela de senha. Para registrar pontos novamente, será preciso digitar a senha do totem.',
            { textoConfirmar: 'Sair', perigo: true }
        );
        if (!ok) return;
        baterPonto.pararReconhecimentoFacial();
        authMod.limparTotemToken();
        window.location.reload();
    });
}

async function mostrarAppTotem() {
    document.getElementById('tela-totem-login').classList.add('escondido');
    document.getElementById('app-totem').classList.remove('escondido');

    iniciarRelogio();
    iniciarNavegacaoTotem();
    iniciarBotoesTotem();

    await recarregarFuncionariosDoTotem();
    baterPonto.autoAbrirCamera();
}

function iniciarLoginTotem() {
    const form = document.getElementById('form-totem-login');
    const erro = document.getElementById('erro-totem-login');
    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        erro.textContent = '';
        try {
            await authMod.loginTotem(document.getElementById('input-totem-senha').value.trim());
            await mostrarAppTotem();
        } catch (e) {
            erro.textContent = e.message;
        }
    });
}

async function iniciarModoTotem() {
    if (authMod.getTotemToken()) {
        try {
            await mostrarAppTotem();
            return;
        } catch (e) {
            authMod.limparTotemToken(); // token inválido/expirado — volta pro login
        }
    }
    document.getElementById('tela-totem-login').classList.remove('escondido');
    iniciarLoginTotem();
}

/* ===================== ADMIN ===================== */

/**
 * Carrega a lista de funcionários que alimenta TODOS os seletores do painel
 * (ajuste manual, relatório individual, banco de horas, férias, faltas).
 *
 * Usa o endpoint ADMINISTRATIVO. Antes usava o mesmo carregamento do totem
 * (/api/funcionarios), que exige o token do tablet — no painel esse token não
 * existe, então a chamada respondia 401, o erro era engolido por um catch
 * silencioso e todos os seletores ficavam VAZIOS. Era essa a causa de "não dá
 * pra escolher o funcionário" no ajuste manual e no relatório individual.
 */
async function recarregarFuncionariosDoAdmin() {
    let funcionarios = [];
    try {
        const todos = await api.listarFuncionariosTodos();
        funcionarios = todos.filter((f) => f.ativo); // seletores mostram só quem está ativo
    } catch (e) {
        console.error('Falha ao carregar funcionários do painel:', e);
        toast(`Não foi possível carregar a lista de funcionários: ${e.message}`, 'erro');
    }

    gestor.popularSeletorAjuste(funcionarios);
    bancoHoras.popularSeletorBanco(funcionarios);
    faltas.setFuncionarios(funcionarios);
    relatorioIndividual.popularSeletorIndividual(funcionarios);
    ferias.setFuncionarios(funcionarios);
    trocas.popularSeletorTrocas(funcionarios);
    return funcionarios;
}

function carregarConteudoAdminAba(nomeAba) {
    clearInterval(intervaloPendencias);

    // O dashboard já traz a situação detalhada do time na mesma resposta —
    // uma chamada por ciclo, em vez de duas.
    if (nomeAba === 'dashboard') {
        dashboard.carregarDashboard();
        intervaloPendencias = setInterval(() => dashboard.carregarDashboard(), 30000);
    }
    if (nomeAba === 'gestor') { editorPontos.iniciarEditorPontos(); gestor.carregarGavetasGerais(); gestor.renderizarRelatorioGestor(); }
    if (nomeAba === 'config') config.renderizarAbaConfig();
    if (nomeAba === 'pendencias') {
        pendencias.carregarPendencias();
        intervaloPendencias = setInterval(() => pendencias.carregarPendencias(), 30000);
    }
    if (nomeAba === 'banco-horas') { bancoHoras.iniciarBancoHoras(); bancoHoras.renderizarGraficoBanco(); }
    if (nomeAba === 'individual') relatorioIndividual.carregarRelatorioIndividual();
    if (nomeAba === 'ferias') ferias.carregarFerias();
    if (nomeAba === 'indicadores') analytics.carregarIndicadores();
    if (nomeAba === 'feriados') feriados.carregarFeriados();
    if (nomeAba === 'faltas') { faltas.iniciarAcoesEmLote(); faltas.carregarFaltas(); }
    if (nomeAba === 'atrasos') { atrasos.iniciarAtrasos(); atrasos.carregarAtrasos(); }
    if (nomeAba === 'trocas') { trocas.iniciarTrocas(); trocas.carregarTrocas(); }
    if (nomeAba === 'escala') { escalaDia.iniciarEscalaDia(); escalaDia.carregarEscalaDia(); }
    if (nomeAba === 'atestados') { atestados.iniciarAtestados(); atestados.carregarAtestados(); }
    if (nomeAba === 'admin-geral') { admin.carregarConfigHorasExtras(); admin.carregarListaAdmins(); admin.iniciarZonaDePerigo(); }
    if (nomeAba === 'biometria') biometria.renderizarAbaBiometria();
    if (nomeAba === 'auditoria') { auditoria.iniciarAuditoria().then(() => auditoria.carregarAuditoria()); }
}

/**
 * Move o indicador deslizante até o item ativo do menu. Mede posição e tamanho do
 * botão porque o menu muda de orientação (vertical no desktop, horizontal e rolável
 * no celular) — usar as duas medidas faz o indicador acompanhar nos dois casos.
 */
function posicionarIndicadorAba(botao) {
    const nav = document.querySelector('.admin-nav');
    const indicador = document.getElementById('admin-nav-indicador');
    if (!nav || !indicador || !botao) return;

    indicador.style.height = `${botao.offsetHeight}px`;
    indicador.style.width = `${botao.offsetWidth}px`;
    indicador.style.transform = `translate(${botao.offsetLeft}px, ${botao.offsetTop}px)`;
    indicador.classList.add('visivel');
}

function mudarAdminAba(nomeAba, botao) {
    if (subAbaAdminAtual === 'biometria' && nomeAba !== 'biometria') biometria.pararCameraAoSair();

    subAbaAdminAtual = nomeAba;
    document.querySelectorAll('.admin-tela').forEach((s) => s.classList.remove('ativa'));
    document.querySelectorAll('.admin-nav button').forEach((b) => b.classList.remove('ativo'));
    document.getElementById(`admin-${nomeAba}`).classList.add('ativa');
    if (botao) {
        botao.classList.add('ativo');
        posicionarIndicadorAba(botao);
    }
    carregarConteudoAdminAba(nomeAba);
}

function iniciarNavegacaoAdmin() {
    document.querySelectorAll('.admin-nav [data-admin-aba]').forEach((btn) => {
        btn.addEventListener('click', () => mudarAdminAba(btn.dataset.adminAba, btn));
    });

    // Cards do dashboard navegam para a aba relacionada (evento vindo de dashboard.js)
    document.addEventListener('navegar-admin', (ev) => {
        const alvo = document.querySelector(`.admin-nav [data-admin-aba="${ev.detail}"]`);
        if (alvo) mudarAdminAba(ev.detail, alvo);
    });
}

function iniciarBotoesAdmin() {
    // Qualquer correção de ponto recarrega o relatório e o histórico, que mudaram junto.
    document.addEventListener('ponto-alterado', () => {
        gestor.carregarGavetasGerais();
        gestor.renderizarRelatorioGestor();
    });
    document.getElementById('btn-exportar-csv')?.addEventListener('click', () => gestor.exportarPlanilhaParaExcel());
    document.getElementById('btn-filtrar-gestor')?.addEventListener('click', () => gestor.renderizarRelatorioGestor());

    document.getElementById('banco-mes')?.addEventListener('change', () => bancoHoras.renderizarGraficoBanco());
    document.getElementById('banco-colaborador')?.addEventListener('change', () => bancoHoras.renderizarGraficoBanco());
    // O menu muda de orientação conforme a largura: o indicador precisa ser
    // reposicionado, senão fica "preso" onde estava antes do redimensionamento.
    window.addEventListener('resize', () => {
        posicionarIndicadorAba(document.querySelector('.admin-nav button.ativo'));
        if (document.getElementById('admin-banco-horas')?.classList.contains('ativa')) {
            bancoHoras.renderizarGraficoBanco();
        }
    });

    // Os gráficos são desenhados em canvas e leem as cores do CSS na hora do traço:
    // trocar o tema exige redesenhar, senão ficam com a paleta antiga.
    document.addEventListener('tema-alterado', () => {
        if (document.getElementById('admin-banco-horas')?.classList.contains('ativa')) {
            bancoHoras.renderizarGraficoBanco();
        }
    });

    document.getElementById('btn-filtrar-individual')?.addEventListener('click', () => relatorioIndividual.carregarRelatorioIndividual());
    document.getElementById('btn-exportar-individual')?.addEventListener('click', () => relatorioIndividual.exportarRelatorioIndividualCSV());
    document.getElementById('btn-ver-espelho-individual')?.addEventListener('click', () => relatorioIndividual.abrirEspelhoDoIndividual());
    document.getElementById('individual-colaborador')?.addEventListener('change', () => relatorioIndividual.carregarRelatorioIndividual());

    document.getElementById('btn-registrar-ferias')?.addEventListener('click', (ev) => comBotaoOcupado(ev.currentTarget, () => ferias.registrarFerias()));

    document.getElementById('btn-filtrar-indicadores')?.addEventListener('click', () => analytics.carregarIndicadores());
    document.getElementById('indicadores-mes')?.addEventListener('change', () => analytics.carregarIndicadores());

    document.getElementById('btn-salvar-feriado')?.addEventListener('click', (ev) => comBotaoOcupado(ev.currentTarget, () => feriados.salvarNovoFeriado()));
    document.getElementById('btn-filtrar-faltas')?.addEventListener('click', () => faltas.carregarFaltas());
    document.getElementById('btn-confirmar-justificativa')?.addEventListener('click', () => faltas.confirmarJustificativa());
    document.getElementById('btn-cancelar-justificativa')?.addEventListener('click', () => {
        document.getElementById('modalJustificarAusencia').style.display = 'none';
    });

    document.getElementById('btn-cadastrar-funcionario')?.addEventListener('click', (ev) => comBotaoOcupado(ev.currentTarget, () => admin.cadastrarFuncionario()));
    document.getElementById('btn-criar-admin')?.addEventListener('click', (ev) => comBotaoOcupado(ev.currentTarget, () => admin.criarAdmin()));
    document.getElementById('btn-trocar-senha-totem')?.addEventListener('click', () => admin.trocarSenhaTotem());

    document.getElementById('btn-sair-admin')?.addEventListener('click', () => {
        authMod.limparAdminToken();
        window.location.reload();
    });

    document.addEventListener('funcionario-cadastrado', recarregarFuncionariosDoAdmin);

    espelho.iniciarEspelho();
}

async function mostrarAppAdmin() {
    document.getElementById('tela-admin-login').classList.add('escondido');
    document.getElementById('app-admin').classList.remove('escondido');
    document.getElementById('nome-admin-logado').textContent = `👤 ${authMod.getAdminNome()}`;

    iniciarNavegacaoAdmin();
    iniciarBotoesAdmin();
    espelho.iniciarEspelho();

    document.getElementById('ajuste-data').value = hojeISO();
    document.getElementById('feriado-data').value = hojeISO();

    // Período padrão do Relatório Consolidado: mês atual até hoje (antes abria vazio)
    const hoje = hojeISO();
    document.getElementById('filtro-inicio').value = `${hoje.substring(0, 7)}-01`;
    document.getElementById('filtro-fim').value = hoje;

    await recarregarFuncionariosDoAdmin();
    carregarConteudoAdminAba('dashboard');
}

function iniciarLoginAdmin() {
    const form = document.getElementById('form-admin-login');
    const erro = document.getElementById('erro-admin-login');
    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        erro.textContent = '';
        try {
            await authMod.loginAdmin(
                document.getElementById('input-admin-email').value.trim(),
                document.getElementById('input-admin-senha').value
            );
            await mostrarAppAdmin();
        } catch (e) {
            erro.textContent = e.message;
        }
    });
}

async function iniciarModoAdmin() {
    if (authMod.getAdminToken()) {
        await mostrarAppAdmin();
        return;
    }
    document.getElementById('tela-admin-login').classList.remove('escondido');
    iniciarLoginAdmin();
}

/* ===================== Fechamento de modais (ESC / clique no fundo) ===================== */

const BOTAO_FECHAR_DO_MODAL = {
    modalCameraPonto: 'btn-fechar-camera-ponto',
    modalPonto: 'btn-fechar-modal-ponto',
    modalJustificarAusencia: 'btn-cancelar-justificativa',
    modalEspelho: 'btn-fechar-espelho'
};

function iniciarFechamentoModais() {
    Object.entries(BOTAO_FECHAR_DO_MODAL).forEach(([idModal, idBotao]) => {
        const overlay = document.getElementById(idModal);
        if (!overlay) return;
        overlay.addEventListener('click', (ev) => {
            if (ev.target === overlay) document.getElementById(idBotao)?.click();
        });
    });

    document.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Escape') return;
        Object.entries(BOTAO_FECHAR_DO_MODAL).forEach(([idModal, idBotao]) => {
            const overlay = document.getElementById(idModal);
            if (overlay && overlay.style.display === 'flex') document.getElementById(idBotao)?.click();
        });
    });
}

/* ===================== Bootstrap ===================== */

async function iniciar() {
    aplicarTemaSalvo();   // antes de qualquer render, para não piscar o tema errado
    montarLogos();
    montarAlternadores();
    iniciarFechamentoModais();
    try {
        if (ehModoAdmin) {
            await iniciarModoAdmin();
        } else {
            await iniciarModoTotem();
        }
    } catch (e) {
        console.error('Erro ao iniciar:', e);
        toast('Não foi possível carregar o sistema. Atualize a página.', 'erro');
    }
}

iniciar();
