import { describe, expect, it } from 'vitest';
import { renderTemplate } from '../src/openai/generator';

describe('renderTemplate', () => {
  it('replaces {{topic}} and {{date}}', () => {
    const out = renderTemplate('เขียนโพสต์เรื่อง {{topic}} ประจำวันที่ {{date}}', {
      topic: 'ข่าวดี',
      date: '9 กรกฎาคม 2569',
    });
    expect(out).toBe('เขียนโพสต์เรื่อง ข่าวดี ประจำวันที่ 9 กรกฎาคม 2569');
  });

  it('tolerates whitespace inside placeholders and missing topic', () => {
    const out = renderTemplate('หัวข้อ: {{ topic }}!', { topic: null, date: 'x' });
    expect(out).toBe('หัวข้อ: !');
  });

  it('fills in the current date when not provided', () => {
    const out = renderTemplate('วันที่ {{date}}', {});
    expect(out).not.toContain('{{date}}');
    expect(out.length).toBeGreaterThan('วันที่ '.length);
  });
});
