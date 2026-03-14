/** Shared ECharts animation defaults - faster than ECharts default (1000ms) */
export const ECHARTS_ANIMATION = {
  animationDuration: 750,
  animationDurationUpdate: 220,
  animationEasing: 'cubicOut',
  animationEasingUpdate: 'cubicOut',
};

export const OVERVIEW_PRESENTATION_INTERVAL_MS = 170;
export const OVERVIEW_PRESENTATION_DURATION_MS = 190;

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
  animationDurationUpdate: 200,
  animationDelayUpdate: 0,
  animationEasingUpdate: 'cubicOut',
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

/** Overview page - base animation config */
export const ECHARTS_OVERVIEW_ANIMATION = {
  animationDuration: 180,
  animationDurationUpdate: 20,
  animationEasing: 'linear',
  animationEasingUpdate: 'linear',
};

/** Overview DailySpark - compact stacked bar */
export const ECHARTS_OVERVIEW_DAILY = {
  ...ECHARTS_OVERVIEW_ANIMATION,
  //animationDuration: 500,
  //animationDurationUpdate: 180,
};

/** Overview Top Repos - horizontal bar chart */
export const ECHARTS_OVERVIEW_BARS = {
  ...ECHARTS_OVERVIEW_ANIMATION,
  //animationDuration: 550,
  //animationDurationUpdate: 170,
};

/** Overview Work Type & Models - donut charts */
export const ECHARTS_OVERVIEW_DONUTS = {
  ...ECHARTS_OVERVIEW_ANIMATION,
  //animationDuration: 580,
  //animationDurationUpdate: 175,
  //animationDelayUpdate: 0,
};
