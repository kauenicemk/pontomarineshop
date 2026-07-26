# Ponto Marine Shop

Sistema de controle de ponto da Marine Shop. Roda em Cloudflare Workers com banco D1.
Duas experiências separadas: o **totem** (tablet fixo na loja, onde o ponto é batido) e o
**painel administrativo** (acessível de qualquer lugar, com login individual por administrador).

---

## 1. Como rodar

```bash
npm install
cp .dev.vars.example .dev.vars   # preencha JWT_SECRET e as senhas iniciais
npm run migrate:local            # cria as tabelas no banco local
npm run dev                      # sobe em http://localhost:8787
```

O sistema **não roda com `node server.js`** — o banco é o Cloudflare D1, que só existe dentro
do Worker. Sempre use `npm run dev` (wrangler).

### Publicar

```bash
npm run backup     # exporta o banco de produção antes de qualquer mudança
npm run migrate    # aplica as migrações pendentes no banco de produção
npm run deploy
```

### Segredos (obrigatórios em produção)

```bash
npx wrangler secret put JWT_SECRET             # valor longo e aleatório
npx wrangler secret put ADMIN_EMAIL_INICIAL
npx wrangler secret put ADMIN_SENHA_INICIAL
npx wrangler secret put TOTEM_SENHA_INICIAL
```

Sem `JWT_SECRET` nenhum login funciona. As duas senhas iniciais só valem no primeiro acesso —
troque-as pelo painel logo em seguida.

### Backup

`npm run backup` gera um `.sql` completo em `backups/` (pasta fora do Git, contém dados
pessoais). Rode antes de migrações, antes de usar a "Zona de perigo" e periodicamente.
Para restaurar: `npx wrangler d1 execute <banco> --remote --file=backups/<arquivo>.sql`.

### Testes

```bash
npm test    # regras de cálculo: atraso, tolerância, horas extras, adicional noturno, saldo
```

## 2. Navegação — totem e painel administrativo são duas experiências separadas

O sistema agora é hospedado na internet, e o cliente definiu que o ponto só pode ser batido de
dentro da empresa, num tablet físico fixo (o "totem"). Por isso a interface virou duas telas
completamente separadas, cada uma com seu próprio login:

- **`/` (totem)** — pede a **senha do totem** (uma senha só, configurada no tablet físico uma
  vez). Depois de entrar, o tablet fica "lembrado" (token de até 90 dias) e mostra só:
  - **Bater Ponto** — mural de funcionários + reconhecimento facial.
  - **Meu Histórico** — cada funcionário confere os próprios registros.
  O funcionário nunca vê nada administrativo por essa tela.

- **`/admin` (painel administrativo)** — pede **login individual** (e-mail + senha, uma conta
  por administrador) e pode ser acessado de qualquer lugar, a qualquer hora. Depois de entrar:
  - **Início** — resumo do dia (presentes, ausentes, atrasados, em intervalo, quem encerrou o
    expediente, horas extras do dia, quem está de férias).
  - Painel do Gestor, Pendências, Banco de Horas, Relatório Individual, Férias, Indicadores,
    Faltas, Feriados, Configurar Horários, Biometria Facial e Administração Geral.

Isso substitui o modelo antigo de "senha de responsável única compartilhada" — agora cada admin
tem sua própria conta (rastreável no log de auditoria), e a senha do totem é uma coisa à parte,
só pra "destravar" o tablet físico. Ver `src/routes/auth.routes.js` e `public/js/auth.js`.

## 3. Jornada configurável em cada dia da semana

Cada funcionário tem sua jornada configurada em **6 dias individuais** — segunda, terça,
quarta, quinta, sexta e sábado, cada um com seu próprio horário de entrada, carga horária e se
é dia de trabalho ou não. Domingo não é configurável: é sempre considerado dia de descanso
(qualquer trabalho vira hora extra/adicional de domingo-feriado, e nunca gera falta).

Isso fica na aba **Administração → Configurar Horários**, uma seção por funcionário. Como agora
são 6 campos por pessoa, tem um atalho "📋 Copiar Segunda-feira para Terça–Sexta" pra não precisar
preencher tudo igual um por um no caso comum (sábado fica de fora do atalho de propósito, já que
costuma ser diferente). Um botão "Salvar tudo" grava regime, tolerância/flexibilidade de almoço
e os 6 dias de uma vez.

Tecnicamente, isso é a tabela `jornada_funcionario` (até 6 linhas por funcionário). Ver
`src/services/funcionarios.service.js` e `src/services/calculoJornada.service.js` — a função
`grupoDoDia` em `src/utils/tempo.js` decide, a partir da data, qual dos 6 dias vale (ou `null`
se for domingo).

Quem já tinha configurado jornada no formato antigo (3 grupos: Segunda-Quinta/Sexta/Sábado) não
perde nada — a migração do D1 expande isso pros 6 dias sozinha na
próxima vez que o servidor subir, preservando os valores.

## 3.1. Adicional noturno e hora extra simplificada

- **Sábado agora conta como "dia útil"** pra fins de percentual de hora extra — só domingo e
  feriado têm percentual diferenciado. Isso mudou na aba **Administração → Administração Geral →
  Percentuais de Hora Extra**: o campo "Sábado" saiu, e entrou o **"Adicional noturno (22h–5h)"**.
- O adicional noturno incide sobre **qualquer minuto trabalhado entre 22h e 5h**, seja hora
  normal ou hora extra — as duas coisas são independentes e se somam quando cabível. Aparece
  como uma coluna própria ("H. Noturna") no relatório do Painel do Gestor e no Relatório
  Individual, com o ícone 🌙.
- **Limitação conhecida:** como cada batida de ponto fica associada à data em que foi batida,
  um turno que atravessa a meia-noite (ex: entrada 22h de um dia, saída 6h do dia seguinte) fica
  registrado em duas datas diferentes no banco. O cálculo do adicional noturno funciona
  corretamente para a parte que cai dentro do mesmo dia dos pontos batidos (22h-24h e 0h-5h
  isoladamente), mas não reconstrói um turno que de fato atravessa a virada — pra esses casos, o
  ideal é o responsável conferir manualmente ou usar o ajuste manual de ponto. Ver o comentário
  em `calcularMinutosNoturnos()` em `src/services/calculoJornada.service.js` pra mais detalhes.

## 4. Efetivação de estagiário e desligamento

**Efetivar:** na aba Configurar Horários, todo funcionário com regime "Estagiário" tem um botão
"🎓 Efetivar (virar CLT)" — um clique já troca o regime para CLT (e a meta de horas dele passa a
seguir as regras de CLT dali em diante; ajustes finos de horário continuam editáveis na mesma tela).
Também dá pra trocar o regime livremente pelo seletor "Regime" de qualquer funcionário, caso o
caso não seja simplesmente estagiário → CLT.

**Demitir / remover:** todo funcionário ativo tem um botão "🗑️ Demitir". O sistema decide sozinho
qual é o jeito certo de remover:
- Se ele **nunca bateu ponto** (cadastro feito por engano, por exemplo), o registro é apagado
  de vez.
- Se ele **já tem histórico de ponto**, o cadastro só é desativado — ele some do mural de bater
  ponto e das listas ativas, mas todo o histórico continua intacto e consultável (necessário
  para fins trabalhistas/auditoria). Um funcionário desligado pode ser "↩️ Readmitido" a
  qualquer momento pela mesma tela.

Ver `funcionariosService.removerOuDemitir()` em `src/services/funcionarios.service.js`.

## 5. Banco de Horas sem depender de CDN externo

A versão anterior desenhava o gráfico com Chart.js, carregado de `cdnjs.cloudflare.com`. Se a
rede do local de uso bloquear esse endereço (proxy corporativo, firewall, ambiente sem saída
para a internet), a biblioteca nunca carrega e o gráfico simplesmente fica em branco — sem
nenhum erro visível para quem está usando o sistema. Isso é provavelmente a causa do "não tá
funcionando".

Para eliminar essa dependência, o gráfico agora é desenhado à mão em cima de um `<canvas>`, com
JavaScript puro (ver `public/js/tabs/bancoHoras.js`) — barras para a visão geral do time, linha
para a evolução de um colaborador específico. Não depende de nenhum arquivo externo, então
funciona igual em qualquer rede, inclusive totalmente offline.

### Visualização individual melhorada

Ao escolher um colaborador específico (em vez de "Visão Geral"), agora aparecem:
- **Cartões de resumo** acima do gráfico: saldo acumulado, melhor dia, pior dia e média por dia.
- **Tooltip ao passar o mouse** sobre o gráfico: mostra a data e o valor exato daquele ponto,
  em vez de só a linha visual.

## 6. Reconhecimento facial (opcional)

O sistema pode reconhecer o funcionário pela câmera na hora de bater ponto — é um ATALHO, não
uma obrigação: se a câmera não identificar ninguém (ou o recurso não estiver instalado), a
seleção manual no mural continua funcionando normalmente, exatamente como hoje.

### Como funciona

- O botão **"📷 Bater ponto com reconhecimento facial"** abre um popup grande com a câmera.
  Ele procura um rosto conhecido continuamente; quando reconhece a MESMA pessoa em 2 frames
  seguidos (confirmação em múltiplos frames — evita que um frame ruim, ângulo estranho ou luz
  baixa, confunda alguém), mostra o emoji e o nome em destaque e libera os botões de marcação
  (Entrada, Saída Almoço, Retorno Almoço, Saída Final) ali mesmo, dentro do popup. Um contorno
  aparece ao redor do rosto detectado — amarelo enquanto ainda está confirmando, verde quando
  confirma. Depois de registrar, o popup volta sozinho para "procurando", pronto pro próximo
  colaborador — sem precisar reabrir nada.
- Roda inteiramente no navegador (`face-api.js`), sem custo por verificação e sem depender de
  internet depois de instalado.
- O navegador calcula um **descritor** do rosto (um vetor de 128 números) e manda só isso pro
  servidor — nunca a foto. O servidor guarda só esse vetor (tabela `biometria_facial`), nunca a
  imagem, e é ele quem decide a identidade (comparando a distância contra os vetores
  cadastrados) — o navegador de quem está batendo o ponto nunca baixa os vetores de mais
  ninguém, só o dele mesmo é gerado localmente.

### No celular, o facial é o principal

Na tela de Bater Ponto, se o dispositivo for detectado como celular/tablet (touch + tela
estreita), o popup da câmera **abre sozinho**, sem precisar clicar em nada — é o fluxo principal
ali. A seleção manual (mural + botões) continua disponível como alternativa, mas nesse caso pede
o **PIN pessoal** do funcionário antes de registrar o ponto (um modal simples, PIN de 4 a 8
dígitos). A ideia é: o facial já confirma sozinho quem é a pessoa, então não precisa de mais
nada; o manual não confirma identidade nenhuma, e no celular não tem um responsável presencial
supervisionando como tem no totem/kiosk fixo — o PIN cobre essa lacuna especificamente aí. No
computador/totem, nada disso muda: a seleção manual continua sem PIN, exatamente como antes.

### Instalação (passo único, precisa de internet)

```bash
npm run setup:biometria
```

Isso baixa a lib `face-api.js` e os modelos treinados (detecção de rosto, pontos faciais e
reconhecimento) e coloca em `public/vendor/face-api/` — **local**, não via CDN (mesmo motivo do
Banco de Horas: se a rede do local de uso bloquear um endereço externo, a função para
silenciosamente). Sem rodar esse comando, o botão de reconhecimento facial simplesmente avisa
que está indisponível e a seleção manual segue funcionando 100%.

### Cadastro dos funcionários

Em **Administração → Biometria Facial**, abra a câmera de cada funcionário e capture até 3
amostras (mais de um ângulo/expressão melhora a taxa de acerto). Isso precisa da senha de
responsável, e do consentimento da pessoa — é dado biométrico, categoria de dado pessoal
sensível pela LGPD.

### Ajustando a sensibilidade

Se o sistema estiver confundindo pessoas parecidas, ou recusando gente demais, ajuste
`BIOMETRIA_LIMIAR` no `.env` (padrão `0.5`) — menor é mais rigoroso, maior é mais permissivo. O
número de frames seguidos exigido pra confirmar (padrão 2) é a constante `FRAMES_PARA_CONFIRMAR`
em `public/js/tabs/baterPonto.js`.

### O que acontece quando alguém é demitido

O botão "Demitir" (ver seção 4) já apaga a biometria da pessoa automaticamente — dado sensível
nunca fica retido de quem não trabalha mais lá, mesmo que o histórico de ponto seja mantido.

### Sobre valor jurídico

Se esse ponto vai servir como prova formal de jornada (fiscalização, reclamação trabalhista),
vale revisar a Portaria 671/2021 do MTE, que trata de sistemas de ponto eletrônico — ela não
proíbe biometria, mas tem exigências próprias (ex: não pode restringir a marcação, geração de
arquivo AFD). Isso é uma camada de compliance separada do reconhecimento em si.

### Usando pelo celular: por que precisa de HTTPS

Navegadores só liberam a câmera em **conexão segura** — HTTPS, ou o endereço especial
`localhost`. No computador que roda o servidor, acessar por `localhost` já conta como seguro,
então a câmera funciona direto. Mas o **celular** acessa pelo IP da rede local (algo como
`http://192.168.0.10:3000`), e isso **não** conta como seguro — o navegador do celular nem
expõe a função de câmera nesse caso (é isso que causa o erro `Cannot read properties of
undefined (reading 'getUserMedia')`).

Solução — gerar um certificado local (passo único, precisa de internet):

```bash
npm run setup:https
```

Isso gera `ssl/cert.pem` e `ssl/key.pem`, válidos para `localhost` e para o(s) IP(s) da rede
local do computador. Reinicie o servidor (`npm run dev`) — ele detecta os arquivos automaticamente
e sobe em HTTPS. O terminal mostra os endereços disponíveis, algo como:

```
✅ Servidor HTTPS rodando em https://localhost:3000
   Pelo celular (mesma rede Wi-Fi): https://192.168.0.10:3000
```

Acesse esse endereço pelo celular. Na primeira vez, o navegador vai mostrar um aviso de
"conexão não segura" — é normal para certificado autoassinado, sem custo. Toque em
"Avançado" (ou "Detalhes") e depois em "Continuar" / "Acessar mesmo assim" — depois disso a
página carrega normalmente e a câmera passa a funcionar, porque o site já conta como contexto
seguro (o navegador só reclama da *confiança* do certificado, não bloqueia a página).

Se o script de `setup:https` der erro (raro, mas pode acontecer dependendo da versão do pacote
usado por trás), a alternativa é gerar o certificado manualmente com o
[mkcert](https://github.com/FiloSottile/mkcert):

```bash
mkcert -key-file ssl/key.pem -cert-file ssl/cert.pem localhost 127.0.0.1 SEU_IP_LOCAL
```

(troque `SEU_IP_LOCAL` pelo IP mostrado no `ipconfig`, no Windows, ou `ifconfig`/`ip addr`, no
Mac/Linux).

## 7. Relatório Individual

Em **Administração → Relatório Individual**, escolha um colaborador e um mês pra ver um resumo
pronto: saldo do mês, dias trabalhados, total de atrasos (em tempo e em número de dias), horas
extras, horas noturnas, valor em R$ de extras/noturno (se o salário estiver cadastrado),
violações de intervalo interjornada e faltas não justificadas no período — sem precisar somar
linha por linha do relatório geral. Tem botão de exportar CSV, botão de ver/imprimir o espelho
de ponto, e uma tabela com o detalhamento dia a dia embaixo do resumo.

## 8. Férias

Em **Administração → Férias**, cada funcionário ativo (com data de admissão cadastrada) aparece
Em **Administração → Férias**, o cadastro é direto: escolha o colaborador, a data de início e a
data de fim (mais uma observação opcional) e clique em Registrar. Sem cálculo de período
aquisitivo, sem tabela do Art. 130 — o cliente pediu simplicidade aqui de propósito, já que a
empresa tem funcionários antigos com anos de histórico irregular de férias, e a ideia é só
conseguir ver rápido:

- Quem está de férias **agora** (aparece também no cartão do dashboard).
- Período (início/fim) de cada registro.
- Situação: 🟢 **De férias agora** / 🔵 **Agendada** (período futuro) / **Encerrada**.
- Histórico básico por colaborador.

Por baixo, cada período de férias registrado cria automaticamente uma ausência do tipo "férias"
pra cada dia do intervalo — reaproveitando a mesma lógica de faltas/relatório que já existe, então
dias de férias nunca contam como falta nem aparecem como pendência. Remover um período de férias
desfaz essas ausências também. Ver `src/services/ferias.service.js`.

## 9. Salário-base e valores em R$

Cada funcionário pode ter um **salário-base** cadastrado (opcional, em Configurar Horários ou no
cadastro inicial). Com isso, o sistema converte os percentuais de hora extra e adicional noturno
— que já eram calculados — em **R$**, usando a fórmula:

```
valor-hora = salário-base / 220   (220h é a jornada mensal de referência, ajustável via
                                     JORNADA_MENSAL_HORAS no .env se a convenção for outra)

valor da hora extra   = (minutos extra / 60)   × valor-hora × (1 + percentual da hora extra)
valor do adic. noturno = (minutos noturnos / 60) × valor-hora × (1 + percentual do noturno)
```

Isso aparece no Relatório Individual, no Painel do Gestor e nos Indicadores. Quem não tiver
salário cadastrado simplesmente não mostra valor em R$ (continua mostrando o percentual e o
tempo normalmente) — não é obrigatório preencher.

## 10. Intervalo interjornada (Art. 66 da CLT)

A CLT exige um mínimo de **11 horas corridas de descanso** entre o fim de um turno e o início do
próximo. O sistema agora verifica isso automaticamente, comparando a saída de um dia com a
entrada do dia seguinte — aparece como alerta no Relatório Individual (com a data e quantas horas
faltaram) e como indicador agregado (quantas violações e quantos funcionários afetados) nos
Indicadores.

**Limitação importante:** como cada batida de ponto fica associada à data em que foi batida, essa
verificação compara corretamente a saída de UM dia com a entrada do dia SEGUINTE — mas não
reconstrói turnos que atravessam a própria meia-noite (mesma limitação já documentada pro
adicional noturno, ver seção 3.1). Isso cobre o caso mais comum (turno que termina tarde num dia
e começa cedo no outro), que é exatamente o que a regra de 11h se destina a prevenir.

## 11. Espelho de ponto assinável (impressão / PDF)

Em vez de gerar o PDF com uma biblioteca no servidor, o espelho de ponto é uma **tela de
impressão** dentro do próprio sistema — o botão "🖨️ Imprimir / Salvar PDF" usa a função nativa do
navegador (o mesmo `Ctrl+P` → "Salvar como PDF" que qualquer site usa), sem precisar de nenhuma
dependência nova no servidor. Só a tabela de pontos, o resumo do mês e a confirmação aparecem na
impressão — o resto da interface some automaticamente (regra de CSS `@media print`).

- **No colaborador** (aba "Meu Histórico"): botão "📄 Ver / Imprimir Meu Espelho de Ponto" — sem
  senha de responsável, mesmo padrão de abertura do resto dessa aba.
- **No responsável** (Relatório Individual): botão "📄 Ver/Imprimir Espelho" pra qualquer
  colaborador selecionado.
- **Confirmação digital**: o botão "✅ Confirmo que revisei este espelho" registra o timestamp
  exato da confirmação (tabela `espelho_confirmacoes`) — a versão digital de "assinar o
  espelho". Não é uma assinatura criptográfica, mas fecha o ciclo "o funcionário viu e
  concordou" que antes não existia, com trilha auditável.

## 12. People Analytics (Indicadores)

Em **Administração → Indicadores**, um painel pensado pra responder perguntas de diretoria, não
só mostrar registro cru:

- **Absenteísmo** (%): faltas não justificadas ÷ dias de trabalho esperados no período.
- **Custo de hora extra e adicional noturno em R$** (depende da seção 9 — quem não tem salário
  cadastrado aparece num aviso separado, pra não subestimar o número silenciosamente).
- **Violações de intervalo interjornada** no período (seção 10), agregadas.
- **Padrão de atraso recorrente** (top 10): ranqueado por **número de dias com atraso**, não só
  o total em minutos — 10 atrasos de 2 minutos é um padrão comportamental diferente de 1 atraso
  de 20 minutos, e o ranking reflete isso.
- **Headcount** por regime (CLT/Estagiário/PJ) e por departamento (campo opcional cadastrado em
  Configurar Horários).

## 13. Dados de teste

Não há seed automático — o script antigo dependia do caminho local com SQLite, que não existe
mais. Para testar, cadastre alguns funcionários pelo painel e, quando terminar, use a
**Zona de perigo** (Administração Geral) para apagar tudo de uma vez: ela remove funcionários,
pontos, jornadas, ausências, férias e biometria, preservando suas contas de administrador,
a senha do totem, feriados e o log de auditoria.

## 14. Sobre não ter migrado para Vite/React

Foi pedido pra repaginar a UI usando Vite. Ficou de fora dessa entrega por uma razão prática: o
ambiente onde este projeto foi montado não tem acesso à internet, então não dava pra instalar o
Vite/React nem rodar `npm run build` pra confirmar que compila de verdade — trocar a base inteira
do frontend sem conseguir testar seria um risco alto pra um sistema desse tamanho. Em vez disso,
a interface levou uma repaginada visual pesada (gradientes, cartões com sombra, animações,
contorno de detecção facial, etc.) em cima da arquitetura atual (HTML/JS modular sem build), que
dá pra validar de verdade. Se quiserem seguir pra Vite/React de fato depois, topo fazer como
próxima etapa, com testes incrementais a cada parte.

## 15. O que mais está corrigido em relação à versão original

- Banco de dados e código-fonte do backend não são mais servidos via HTTP (`src/app.js` só
  expõe `public/`).
- PIN de funcionário hasheado com bcrypt.
- Toda ação administrativa exige a senha de responsável, validada de novo no backend
  (`src/middleware/adminAuth.js`) — nunca só escondida na tela.
- Rate limiting nas rotas sensíveis, log de auditoria de toda ação administrativa
  (`src/utils/auditoria.js`), validação de entrada em todas as rotas.
- Regra de tolerância de almoço configurável por funcionário (em vez de hardcoded por nome).
- Datas em formato ISO com índices no banco (filtro de período feito no SQL, não no navegador).
- Feriados, faltas (agora cientes da jornada individual — quem não trabalha sábado não "falta"
  no sábado) e percentuais de hora extra configuráveis.
- `alert()` nativo trocado por notificações; toda renderização usa `escapeHtml()`.

## 16. Estrutura de pastas

```
public/_worker.js             # ponto de entrada no Cloudflare (assets + API + bootstrap inicial)
migrations/                   # migrações do D1 (aplicar com: npm run migrate)
scripts/
  backup.js                    # exporta o banco de produção (npm run backup)
  instalar-biometria.js        # baixa face-api.js + modelos (npm run setup:biometria)
src/
  app.js                      # wiring do Hono (CSP, rate limit, contexto de auditoria, rotas)
  config.js                   # valores padrão de jornada, horas extras, tolerância e biometria
  db/db.js                    # wrapper do Cloudflare D1 (mesma assinatura run/get/all/exec)
  middleware/
    adminAuth.js               # valida o JWT do administrador e identifica o autor da ação
    totemAuth.js               # valida o token do tablet
    rateLimiters.js
    errorHandler.js
  routes/                     # uma rota por recurso, fina, delega para services/
  services/
    funcionarios.service.js    # CRUD, jornada (6 dias), regime, demissão, dados cadastrais
    biometria.service.js       # cadastro de amostras faciais + reconhecimento (server-side)
    ponto.service.js           # bater ponto, corrigir/apagar batida, histórico, pendências
    calculoJornada.service.js  # funções puras: tempo, atraso, extras, noturno, valor R$, interjornada
    relatorio.service.js       # relatório geral + relatório individual agregado
    dashboard.service.js       # resumo do dia + situação do time numa única resposta
    ferias.service.js          # períodos de férias e status (ativa/futura/encerrada)
    espelho.service.js         # confirmação digital do espelho de ponto mensal
    analytics.service.js       # indicadores agregados (absenteísmo, custo, atrasos, headcount)
    feriados.service.js
    ausencias.service.js       # faltas cientes da jornada + justificativa em massa
  utils/
    tempo.js                   # conversões de hora/data, grupoDoDia() (6 dias), janela noturna
    validacao.js               # validadores manuais de entrada (inclui descritor facial)
    auditoria.js               # log de ações administrativas, com o autor de cada uma
    contextoRequisicao.js      # leva o admin logado até o log, isolado por requisição
    jwtAuth.js                 # assinatura e verificação dos tokens
    cabecalhosSeguranca.js     # CSP e demais cabeçalhos aplicados às páginas
tests/                        # testes das regras de cálculo (npm test)
public/
  index.html
  css/styles.css
  img/                        # logo da Marine Shop (ver LEIA-ME.txt)
  vendor/face-api/            # lib + modelos de reconhecimento facial (npm run setup:biometria)
  js/
    main.js                    # bootstrap e navegação (totem e painel)
    api.js                     # camada única de acesso à API
    brand.js                   # nome e logo do sistema — único lugar para trocar
    pin.js                     # PIN pessoal do funcionário no totem
    turno.js                   # turno derivado do horário de entrada
    confirmar.js               # modal de confirmação
    faceRecognition.js         # wrapper do face-api.js (descritor + caixa de detecção)
    toast.js
    utils.js
    tabs/                       # um módulo por aba/sub-aba, inclui:
                                 #   ferias.js, espelho.js, analytics.js, relatorioIndividual.js,
                                 #   biometria.js
data/
  ponto.db                     # criado automaticamente, NUNCA versionado (.gitignore)
ssl/
  cert.pem, key.pem            # gerados via "npm run setup:https", NUNCA versionados
```

## 17. Recomendações futuras (não bloqueantes)

- Migrar o frontend para um framework de componentes (React) quando o time de desenvolvimento
  crescer — hoje está em JS modular vanilla para não exigir passo de build.
- Migrar de SQLite para PostgreSQL se o produto virar SaaS multi-cliente.
- Exportação em formato oficial (eSocial/AFD) se o público-alvo for Departamento Pessoal formal.
