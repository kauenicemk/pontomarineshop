import * as authMod from './auth.js';
import { toast } from './toast.js';
import { hojeISO } from './utils.js';

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

const ehModoAdmin = window.location.pathname.startsWith('/admin');

let intervaloPendencias = null;
let subAbaAdminAtual = 'dashboard';

/* ===================== Relógio (usado no totem) ===================== */

function iniciarRelogio() {
    const el = document.getElementById('relogio');
    if (!el) return;
    function atualizar() {
        el.textContent = new Intl.DateTimeFormat('pt-BR', {
            timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit'
        }).format(new Date());
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
}

function iniciarNavegacaoTotem() {
    document.querySelectorAll('.totem-nav [data-totem-aba]').forEach((btn) => {
        btn.addEventListener('click', () => mudarTotemAba(btn.dataset.totemAba, btn));
    });
}

function iniciarBotoesTotem() {
    document.getElementById('btn-fechar-modal-ponto')?.addEventListener('click', () => {
        document.getElementById('modalPonto').style.display = 'none';
    });
    baterPonto.iniciarBusca();
    baterPonto.iniciarBotoesDePonto();
    baterPonto.iniciarReconhecimentoFacial();
    espelho.iniciarEspelho();
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

async function recarregarFuncionariosDoAdmin() {
    const funcionarios = await baterPonto.carregarMuralFuncionarios().catch(() => []);
    gestor.popularSeletorAjuste(funcionarios);
    bancoHoras.popularSeletorBanco(funcionarios);
    faltas.setFuncionarios(funcionarios);
    relatorioIndividual.popularSeletorIndividual(funcionarios);
    ferias.setFuncionarios(funcionarios);
    return funcionarios;
}

function carregarConteudoAdminAba(nomeAba) {
    clearInterval(intervaloPendencias);

    if (nomeAba === 'dashboard') {
        dashboard.carregarDashboard();
        pendencias.carregarPendencias();
        intervaloPendencias = setInterval(() => { dashboard.carregarDashboard(); pendencias.carregarPendencias(); }, 30000);
    }
    if (nomeAba === 'gestor') { gestor.carregarGavetasGerais(); gestor.renderizarRelatorioGestor(); }
    if (nomeAba === 'config') config.renderizarAbaConfig();
    if (nomeAba === 'pendencias') {
        pendencias.carregarPendencias();
        intervaloPendencias = setInterval(() => pendencias.carregarPendencias(), 30000);
    }
    if (nomeAba === 'banco-horas') bancoHoras.renderizarGraficoBanco();
    if (nomeAba === 'individual') relatorioIndividual.carregarRelatorioIndividual();
    if (nomeAba === 'ferias') ferias.carregarFerias();
    if (nomeAba === 'indicadores') analytics.carregarIndicadores();
    if (nomeAba === 'feriados') feriados.carregarFeriados();
    if (nomeAba === 'faltas') faltas.carregarFaltas();
    if (nomeAba === 'admin-geral') { admin.carregarConfigHorasExtras(); admin.carregarListaAdmins(); }
    if (nomeAba === 'biometria') biometria.renderizarAbaBiometria();
}

function mudarAdminAba(nomeAba, botao) {
    if (subAbaAdminAtual === 'biometria' && nomeAba !== 'biometria') biometria.pararCameraAoSair();

    subAbaAdminAtual = nomeAba;
    document.querySelectorAll('.admin-tela').forEach((s) => s.classList.remove('ativa'));
    document.querySelectorAll('.admin-nav button').forEach((b) => b.classList.remove('ativo'));
    document.getElementById(`admin-${nomeAba}`).classList.add('ativa');
    if (botao) botao.classList.add('ativo');
    carregarConteudoAdminAba(nomeAba);
}

function iniciarNavegacaoAdmin() {
    document.querySelectorAll('.admin-nav [data-admin-aba]').forEach((btn) => {
        btn.addEventListener('click', () => mudarAdminAba(btn.dataset.adminAba, btn));
    });
}

function iniciarBotoesAdmin() {
    document.getElementById('btn-salvar-ajuste')?.addEventListener('click', () => gestor.salvarAjusteManual());
    document.getElementById('btn-exportar-csv')?.addEventListener('click', () => gestor.exportarPlanilhaParaExcel());
    document.getElementById('btn-filtrar-gestor')?.addEventListener('click', () => gestor.renderizarRelatorioGestor());

    document.getElementById('banco-mes')?.addEventListener('change', () => bancoHoras.renderizarGraficoBanco());
    document.getElementById('banco-colaborador')?.addEventListener('change', () => bancoHoras.renderizarGraficoBanco());
    window.addEventListener('resize', () => {
        if (document.getElementById('admin-banco-horas')?.classList.contains('ativa')) {
            bancoHoras.renderizarGraficoBanco();
        }
    });

    document.getElementById('btn-filtrar-individual')?.addEventListener('click', () => relatorioIndividual.carregarRelatorioIndividual());
    document.getElementById('btn-exportar-individual')?.addEventListener('click', () => relatorioIndividual.exportarRelatorioIndividualCSV());
    document.getElementById('btn-ver-espelho-individual')?.addEventListener('click', () => relatorioIndividual.abrirEspelhoDoIndividual());
    document.getElementById('individual-colaborador')?.addEventListener('change', () => relatorioIndividual.carregarRelatorioIndividual());

    document.getElementById('btn-registrar-ferias')?.addEventListener('click', () => ferias.registrarFerias());

    document.getElementById('btn-filtrar-indicadores')?.addEventListener('click', () => analytics.carregarIndicadores());
    document.getElementById('indicadores-mes')?.addEventListener('change', () => analytics.carregarIndicadores());

    document.getElementById('btn-salvar-feriado')?.addEventListener('click', () => feriados.salvarNovoFeriado());
    document.getElementById('btn-filtrar-faltas')?.addEventListener('click', () => faltas.carregarFaltas());
    document.getElementById('btn-confirmar-justificativa')?.addEventListener('click', () => faltas.confirmarJustificativa());
    document.getElementById('btn-cancelar-justificativa')?.addEventListener('click', () => {
        document.getElementById('modalJustificarAusencia').style.display = 'none';
    });

    document.getElementById('btn-cadastrar-funcionario')?.addEventListener('click', () => admin.cadastrarFuncionario());
    document.getElementById('btn-criar-admin')?.addEventListener('click', () => admin.criarAdmin());
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

/* ===================== Bootstrap ===================== */

async function iniciar() {
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
