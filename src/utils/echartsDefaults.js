/** Shared ECharts animation defaults - faster than ECharts default (1000ms) */
export const ECHARTS_ANIMATION = {
  animationDuration: 750,
  animationDurationUpdate: 220,
  animationEasing: 'cubicOut',
  animationEasingUpdate: 'cubicOut',
};

/** Label animation - fade in after chart finishes, same duration and cubicOut easing */
export const ECHARTS_LABEL_ANIMATION = {
  show: true,
  animationDuration: 250,
  animationDurationUpdate: 220,
  animationDelay: 250,
  animationDelayUpdate: 180,
  animationEasing: 'cubicOut',
  animationEasingUpdate: 'cubicOut',
};

/** Detail donut charts (Repos/Models/Daily) - same as bar, shared config */
export const ECHARTS_DONUT_ANIMATION = {
  ...ECHARTS_ANIMATION,
};

/** Detail bar charts (Repos/Models/Daily) - delayed so they finish with donuts */
export const ECHARTS_DETAIL_BAR_ANIMATION = {
  animationDuration: 700,
  animationDurationUpdate: 220,
  animationDelay: 250,
  animationDelayUpdate: 140,
  animationEasing: 'cubicOut',
  animationEasingUpdate: 'cubicOut',
};

/** Detail bar labels - delay until bar animation finishes */
export const ECHARTS_DETAIL_BAR_LABEL_ANIMATION = {
  ...ECHARTS_LABEL_ANIMATION,
  animationDelay: 950,
  animationDelayUpdate: 360,
};
