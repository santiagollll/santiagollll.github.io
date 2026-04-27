const moneyFormatter = new Intl.NumberFormat("es-CL", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

const decimalFormatter = new Intl.NumberFormat("es-CL", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 8
});

const percentageFormatter = new Intl.NumberFormat("es-CL", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 6
});

const shotsInput = document.querySelector("#shots-input");
const loseOutcomesInput = document.querySelector("#lose-outcomes-input");
const totalOutcomesInput = document.querySelector("#total-outcomes-input");
const probabilityFormula = document.querySelector("#probability-formula");
const loseAllPercent = document.querySelector("#lose-all-percent");
const loseAllDecimal = document.querySelector("#lose-all-decimal");
const winOncePercent = document.querySelector("#win-once-percent");
const winOnceDecimal = document.querySelector("#win-once-decimal");
const probabilityExplainer = document.querySelector("#probability-explainer");
const advancedProbabilityCopy = document.querySelector("#advanced-probability-copy");

const maxRoundInput = document.querySelector("#max-round-input");
const amountInput = document.querySelector("#amount-input");
const amountLabel = document.querySelector("#amount-label");
const earlyWinSelect = document.querySelector("#early-win-select");
const firstBetOutput = document.querySelector("#first-bet");
const totalInvestedMaxOutput = document.querySelector("#total-invested-max");
const totalInvestedEarlyOutput = document.querySelector("#total-invested-early");
const netGainMaxOutput = document.querySelector("#net-gain-max");
const netGainEarlyOutput = document.querySelector("#net-gain-early");
const earlyWinCaption = document.querySelector("#early-win-caption");
const betSteps = document.querySelector("#bet-steps");
const moneySummary = document.querySelector("#money-summary");
const riskWarning = document.querySelector("#risk-warning");
const entryModeInputs = document.querySelectorAll('input[name="entry-mode"]');

function sanitizeInteger(value, fallback = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(1, Math.floor(number));
}

function sanitizeNonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(0, Math.floor(number));
}

function sanitizePositiveAmount(value, fallback = 1) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }
  return number;
}

function formatCurrency(value) {
  if (!Number.isFinite(value)) {
    return "Monto inválido";
  }
  return `$${moneyFormatter.format(value)}`;
}

function formatDecimal(value) {
  if (!Number.isFinite(value)) {
    return "Valor inválido";
  }
  return decimalFormatter.format(value);
}

function getEntryMode() {
  const selected = Array.from(entryModeInputs).find((input) => input.checked);
  return selected ? selected.value : "stake";
}

function getProbabilitySettings() {
  const loseOutcomes = sanitizeNonNegativeInteger(loseOutcomesInput.value, 10);
  const totalOutcomes = sanitizeInteger(totalOutcomesInput.value, 19);
  const safeLoseOutcomes = Math.min(loseOutcomes, totalOutcomes);
  const loseProbability = totalOutcomes === 0 ? 0 : safeLoseOutcomes / totalOutcomes;

  loseOutcomesInput.value = String(safeLoseOutcomes);
  totalOutcomesInput.value = String(totalOutcomes);

  return {
    loseOutcomes: safeLoseOutcomes,
    totalOutcomes,
    loseProbability,
    winProbability: 1 - loseProbability
  };
}

function updateEarlyWinOptions(maxRounds) {
  const previousValue = sanitizeInteger(earlyWinSelect.value || "1", 1);
  earlyWinSelect.innerHTML = "";

  for (let round = 1; round <= maxRounds; round += 1) {
    const option = document.createElement("option");
    option.value = String(round);
    option.textContent = `Tiro ${round}`;
    earlyWinSelect.appendChild(option);
  }

  earlyWinSelect.value = String(Math.min(previousValue, maxRounds));
}

function updateProbabilityCalculator() {
  const rounds = sanitizeInteger(shotsInput.value, 5);
  const { loseOutcomes, totalOutcomes, loseProbability, winProbability } = getProbabilitySettings();
  const loseAll = loseProbability ** rounds;
  const winAtLeastOnce = 1 - loseAll;

  shotsInput.value = String(rounds);
  probabilityFormula.innerHTML = `(${loseOutcomes}/${totalOutcomes})<sup>${rounds}</sup>`;
  loseAllPercent.textContent = percentageFormatter.format(loseAll);
  loseAllDecimal.textContent = `Decimal: ${formatDecimal(loseAll)}`;
  winOncePercent.textContent = percentageFormatter.format(winAtLeastOnce);
  winOnceDecimal.textContent = `Decimal: ${formatDecimal(winAtLeastOnce)}`;
  probabilityExplainer.innerHTML = `
    <p>Si haces <strong>${rounds} tiros</strong>, la probabilidad de perderlos todos seguidos es
    <strong>${percentageFormatter.format(loseAll)}</strong>.</p>
    <p>La probabilidad de <strong>ganar al menos una vez</strong> dentro de esos ${rounds} tiros es
    <strong>${percentageFormatter.format(winAtLeastOnce)}</strong>.</p>
    <p>Con la configuración actual, cada tiro tiene una probabilidad de perder de
    <strong>${percentageFormatter.format(loseProbability)}</strong> y de ganar de
    <strong>${percentageFormatter.format(winProbability)}</strong>.</p>
  `;
  advancedProbabilityCopy.textContent =
    `Configuración actual: perder = ${loseOutcomes}/${totalOutcomes} (${percentageFormatter.format(loseProbability)}), ganar = ${totalOutcomes - loseOutcomes}/${totalOutcomes} (${percentageFormatter.format(winProbability)}).`;
}

function buildStepCopy(rounds, firstBet) {
  const steps = [];
  const visibleRounds = Math.min(rounds, 8);

  for (let round = 1; round <= visibleRounds; round += 1) {
    const bet = firstBet * 2 ** (round - 1);
    const total = firstBet * (2 ** round - 1);
    const step = document.createElement("li");
    step.innerHTML = `
      <strong>Tiro ${round}:</strong> apuesta ${formatCurrency(bet)}.
      Si llegas hasta aquí, ya habrás invertido ${formatCurrency(total)} en total.
    `;
    steps.push(step);
  }

  if (rounds > visibleRounds) {
    const extraStep = document.createElement("li");
    extraStep.textContent =
      `La secuencia sigue duplicando hasta el tiro ${rounds}. No la mostramos completa para que sea fácil de leer.`;
    steps.push(extraStep);
  }

  return steps;
}

function updateMoneyCalculator() {
  const mode = getEntryMode();
  const maxRounds = sanitizeInteger(maxRoundInput.value, 5);
  const baseAmount = sanitizePositiveAmount(amountInput.value, 1000);

  maxRoundInput.value = String(maxRounds);
  amountInput.value = String(baseAmount);
  amountLabel.textContent =
    mode === "stake" ? "Dinero del primer tiro" : "Ganancia neta deseada del ciclo";

  updateEarlyWinOptions(maxRounds);

  const selectedRound = sanitizeInteger(earlyWinSelect.value, 1);
  const firstBet = baseAmount;
  const targetNetGain = baseAmount;
  const finalBetAtMax = firstBet * 2 ** (maxRounds - 1);
  const totalInvestedAtMax = firstBet * (2 ** maxRounds - 1);
  const selectedBet = firstBet * 2 ** (selectedRound - 1);
  const totalInvestedAtSelected = firstBet * (2 ** selectedRound - 1);
  const previousLossesAtSelected = totalInvestedAtSelected - selectedBet;

  firstBetOutput.textContent = formatCurrency(firstBet);
  totalInvestedMaxOutput.textContent = formatCurrency(totalInvestedAtMax);
  totalInvestedEarlyOutput.textContent = formatCurrency(totalInvestedAtSelected);
  netGainMaxOutput.textContent = formatCurrency(targetNetGain);
  netGainEarlyOutput.textContent = formatCurrency(targetNetGain);
  earlyWinCaption.textContent =
    `Si ganas en el tiro ${selectedRound}, la ganancia neta del ciclo sigue siendo ${formatCurrency(targetNetGain)}.`;

  betSteps.innerHTML = "";
  buildStepCopy(maxRounds, firstBet).forEach((step) => betSteps.appendChild(step));

  moneySummary.innerHTML = `
    <p>Si piensas llegar como máximo hasta el <strong>tiro ${maxRounds}</strong>, debes estar listo para apostar
    <strong>${formatCurrency(finalBetAtMax)}</strong> en ese último tiro y haber movido
    <strong>${formatCurrency(totalInvestedAtMax)}</strong> en total.</p>
    <p>Si ganas antes, por ejemplo en el <strong>tiro ${selectedRound}</strong>, en ese tiro apostarías
    <strong>${formatCurrency(selectedBet)}</strong>, habrías perdido antes
    <strong>${formatCurrency(previousLossesAtSelected)}</strong>, y terminarías con una ganancia neta de
    <strong>${formatCurrency(targetNetGain)}</strong>.</p>
    <p>${mode === "stake"
      ? "Como partiste desde la apuesta inicial, esa misma cantidad es la ganancia neta que persigue la estrategia."
      : "Como partiste desde una ganancia objetivo, el sistema usa ese valor como apuesta inicial para conservar esa misma ganancia neta al ganar."}</p>
  `;

  const warningThreshold = 250000;
  if (totalInvestedAtMax >= warningThreshold || maxRounds >= 10) {
    riskWarning.hidden = false;
    riskWarning.textContent =
      "Atención: en esta estrategia los montos crecen de forma exponencial. Unos pocos tiros extra pueden disparar muy rápido el capital necesario.";
  } else {
    riskWarning.hidden = true;
    riskWarning.textContent = "";
  }
}

function syncCalculators() {
  updateProbabilityCalculator();
  updateMoneyCalculator();
}

[
  shotsInput,
  loseOutcomesInput,
  totalOutcomesInput,
  maxRoundInput,
  amountInput,
  earlyWinSelect
].forEach((element) => {
  element.addEventListener("input", syncCalculators);
  element.addEventListener("change", syncCalculators);
});

entryModeInputs.forEach((input) => {
  input.addEventListener("change", syncCalculators);
});

syncCalculators();
