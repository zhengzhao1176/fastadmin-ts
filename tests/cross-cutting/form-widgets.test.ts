// Unit coverage for the extended `\fast\Form` widget builders — doc 1264.
// Pure HTML-string generators, no DB / no HTTP server.
import { describe, expect, it } from 'vitest'
import {
  label, password, hidden, email, url, file, editor, slider,
  selectpicker, selectpages, citypicker, switcher,
  datepicker, datetimepicker, datetimerange, fieldlist, button,
  image, upload, selectRange, selectMonth, Form,
} from '../../ts/src/common/form.ts'

describe('Form — basic typed inputs', () => {
  it('password input', () => {
    expect(password('pwd')).toContain('type="password"')
    expect(password('pwd')).toContain('name="pwd"')
  })
  it('hidden input carries its value', () => {
    expect(hidden('h', 'v')).toMatch(/type="hidden"/)
    expect(hidden('h', 'v')).toContain('value="v"')
  })
  it('email / url inputs', () => {
    expect(email('e')).toContain('type="email"')
    expect(url('u')).toContain('type="url"')
  })
  it('file input', () => {
    expect(file('f')).toContain('type="file"')
  })
  it('label defaults to a title-cased field name', () => {
    expect(label('user_name')).toBe('<label for="user_name">User Name</label>')
  })
})

describe('Form — rich widgets', () => {
  it('editor → textarea with the editor class', () => {
    const html = editor('content', 'hi')
    expect(html).toMatch(/^<textarea/)
    expect(html).toContain('editor')
    expect(html).toContain('>hi</textarea>')
  })
  it('slider carries data-slider-* attributes', () => {
    const html = slider('progress', 0, 100, 5, 50)
    expect(html).toContain('data-slider-min="0"')
    expect(html).toContain('data-slider-max="100"')
    expect(html).toContain('data-slider-step="5"')
    expect(html).toContain('slider')
  })
  it('selectpicker → select with the selectpicker class', () => {
    const html = selectpicker('s', { a: 'A', b: 'B' }, 'b')
    expect(html).toMatch(/^<select/)
    expect(html).toContain('selectpicker')
    expect(html).toContain('<option value="b" selected="selected">B</option>')
  })
  it('selectpages → multi SelectPage with data-source + data-multiple', () => {
    const html = selectpages('cat', '', 'category/selectpage')
    expect(html).toMatch(/class="selectpage form-control"/)
    expect(html).toContain('data-source="category/selectpage"')
    expect(html).toContain('data-multiple="true"')
  })
  it('citypicker → text input wrapped in .control-relative', () => {
    const html = citypicker('city', '')
    expect(html).toContain('control-relative')
    expect(html).toContain('data-toggle="city-picker"')
  })
  it('switcher → hidden input + data-toggle="switcher" anchor', () => {
    const html = switcher('status', 1)
    expect(html).toContain('type="hidden"')
    expect(html).toContain('data-toggle="switcher"')
    expect(html).toContain('data-yes="1"')
    expect(html).toContain('data-no="0"')
  })
  it('datepicker / datetimepicker carry the right format', () => {
    expect(datepicker('d')).toContain('data-date-format="YYYY-MM-DD"')
    expect(datetimepicker('dt')).toContain('data-date-format="YYYY-MM-DD HH:mm:ss"')
    expect(datetimepicker('dt')).toContain('datetimepicker')
  })
  it('datetimerange → text input with the datetimerange class', () => {
    expect(datetimerange('range')).toContain('datetimerange')
  })
  it('fieldlist → <dl class="fieldlist"> with a hidden textarea', () => {
    const html = fieldlist('json', { a: 'b' })
    expect(html).toContain('<dl class="fieldlist" data-name="json"')
    expect(html).toContain('btn-append')
    expect(html).toContain('<textarea name="json"')
  })
  it('button → <button type="button">', () => {
    expect(button('Save')).toBe('<button type="button">Save</button>')
  })
  it('image / upload widgets render the faupload + fachoose buttons', () => {
    const img = image('avatar')
    expect(img).toContain('faupload')
    expect(img).toContain('fachoose')
    expect(img).toContain('data-mimetype="image/*"')
    expect(upload('attach')).toContain('data-mimetype="*"')
  })
  it('selectRange / selectMonth build numeric option lists', () => {
    const r = selectRange('n', 1, 3)
    expect(r).toContain('<option value="1">1</option>')
    expect(r).toContain('<option value="3">3</option>')
    expect(selectMonth('m')).toContain('<option value="12">12</option>')
  })
})

describe('Form facade', () => {
  it('exposes every widget as a method', () => {
    for (const k of ['input', 'select', 'switcher', 'fieldlist', 'datetimepicker', 'selectpage']) {
      expect(typeof (Form as Record<string, unknown>)[k]).toBe('function')
    }
  })
})
