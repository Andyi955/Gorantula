import { toPng, toSvg } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { saveAs } from 'file-saver';

export const exportAsPng = async (elementId: string) => {
    const element = document.getElementById(elementId);
    if (!element) return;

    try {
        const dataUrl = await toPng(element, {
            backgroundColor: '#050505', // cyber-black
            cacheBust: true,
            style: {
                borderRadius: '0',
            }
        });
        saveAs(dataUrl, `gorantula-board-${new Date().getTime()}.png`);
    } catch (err) {
        console.error('Failed to export PNG:', err);
    }
};

export const exportAsSvg = async (elementId: string) => {
    const element = document.getElementById(elementId);
    if (!element) return;

    try {
        const dataUrl = await toSvg(element, {
            backgroundColor: '#050505',
            cacheBust: true,
        });
        saveAs(dataUrl, `gorantula-board-${new Date().getTime()}.svg`);
    } catch (err) {
        console.error('Failed to export SVG:', err);
    }
};

export interface ReportData {
    topic: string;
    finalSynthesis: string;
    nodes: Array<{
        title: string;
        summary: string;
        sourceURL: string;
    }>;
}

export const exportAsPdf = async (data: ReportData) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    const contentWidth = pageWidth - 2 * margin;
    let yPos = 20;

    // Title
    doc.setFontSize(22);
    doc.setTextColor(0, 243, 255); // cyber-cyan
    doc.text('INTEL REPORT: ' + data.topic.toUpperCase(), margin, yPos);
    yPos += 15;

    // Final Synthesis
    doc.setFontSize(14);
    doc.setTextColor(188, 19, 254); // cyber-purple
    doc.text('EXECUTIVE SUMMARY', margin, yPos);
    yPos += 10;

    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    const synthesisLines = doc.splitTextToSize(data.finalSynthesis, contentWidth);
    doc.text(synthesisLines, margin, yPos);
    yPos += (synthesisLines.length * 5) + 15;

    // Evidence Nodes
    doc.setFontSize(14);
    doc.setTextColor(188, 19, 254);
    doc.text('EVIDENCE NODES', margin, yPos);
    yPos += 10;

    data.nodes.forEach((node, i) => {
        if (yPos > 250) {
            doc.addPage();
            yPos = 20;
        }

        doc.setFontSize(11);
        doc.setTextColor(0, 243, 255);
        doc.text(`${i + 1}. ${node.title}`, margin, yPos);
        yPos += 7;

        doc.setFontSize(9);
        doc.setTextColor(150, 150, 150);
        const summaryLines = doc.splitTextToSize(node.summary, contentWidth);
        doc.text(summaryLines, margin, yPos);
        yPos += (summaryLines.length * 4) + 5;

        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.text(`Source: ${node.sourceURL}`, margin, yPos);
        yPos += 12;
    });

    doc.save(`gorantula-report-${new Date().getTime()}.pdf`);
};
