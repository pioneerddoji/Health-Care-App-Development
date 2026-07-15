// 앱 내 차트 — svg.ts가 만든 SVG 문자열을 SvgXml로 렌더 (PDF와 동일 코드 경로)
import React from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { SvgXml } from 'react-native-svg';
import {
  lineChartSvg, barChartSvg, groupedBarSvg, timelineSvg,
  LineChartOpts, BarChartOpts, GroupedBarOpts, TimelineOpts,
} from './svg';

const ChartCard = ({ title, xml }: { title: string; xml: string }) => (
  <View style={styles.card}>
    <Text style={styles.title}>{title}</Text>
    <SvgXml xml={xml} width="100%" />
  </View>
);

const useChartWidth = () => {
  const { width } = useWindowDimensions();
  return Math.min(width - 64, 480);
};

export const LineChart = ({ title, ...opts }: LineChartOpts & { title: string }) => {
  const width = useChartWidth();
  return <ChartCard title={title} xml={lineChartSvg({ ...opts, width })} />;
};

export const BarChart = ({ title, ...opts }: BarChartOpts & { title: string }) => {
  const width = useChartWidth();
  return <ChartCard title={title} xml={barChartSvg({ ...opts, width })} />;
};

export const GroupedBarChart = ({ title, ...opts }: GroupedBarOpts & { title: string }) => {
  const width = useChartWidth();
  return <ChartCard title={title} xml={groupedBarSvg({ ...opts, width })} />;
};

export const SymptomTimeline = ({ title, ...opts }: TimelineOpts & { title: string }) => {
  const width = useChartWidth();
  return <ChartCard title={title} xml={timelineSvg({ ...opts, width })} />;
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fcfcfb',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(11,11,11,0.10)',
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0b0b0b',
    marginBottom: 8,
  },
});
