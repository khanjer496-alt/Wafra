import { createHash } from 'node:crypto';

/** Deterministic graph helpers. Data stays in local action variables. */
export const uuid = name => {
  const value = createHash('sha256').update('wafra.history.vnext.' + name).digest('hex').slice(0, 32).toUpperCase();
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
};
export const action = (id, name, params = {}) => ({ WFWorkflowActionIdentifier: id,
  WFWorkflowActionParameters: { UUID: uuid(name), CustomOutputName: name, ...params } });
export const value = name => ({ Type: 'ActionOutput', OutputUUID: uuid(name), OutputName: name });
export const output = name => ({ Value: value(name), WFSerializationType: 'WFTextTokenAttachment' });
export const text = (string, attachmentsByRange) => ({ Value: { string,
  ...(attachmentsByRange ? { attachmentsByRange } : {}) }, WFSerializationType: 'WFTextTokenString' });
export const textOutput = name => text('\ufffc', { '{0, 1}': value(name) });
/** Date fields are serialized text fields even when the variable holds Date.
 * Installed WFDateFieldParameter discards a bare WFTextTokenAttachment. */
export const dateField = reference => {
  if (reference?.WFSerializationType === 'WFTextTokenString') return reference;
  if (reference?.WFSerializationType !== 'WFTextTokenAttachment' || !reference.Value) throw Error('invalid_date_field');
  return text('\ufffc', { '{0, 1}': reference.Value });
};
export const variable = (name, properties = []) => ({ Value: { Type: 'Variable', VariableName: name,
  ...(properties.length ? { Aggrandizements: properties.map(PropertyName => ({
    Type: 'WFPropertyVariableAggrandizement', PropertyName })) } : {}) }, WFSerializationType: 'WFTextTokenAttachment' });
export const property = (name, key) => ({ Value: { ...value(name), Aggrandizements: [
  { Type: 'WFPropertyVariableAggrandizement', PropertyName: key },
] }, WFSerializationType: 'WFTextTokenAttachment' });
export const stop = () => ({ WFWorkflowActionIdentifier: 'is.workflow.actions.exit', WFWorkflowActionParameters: {} });
export const count = (name, source) => action('is.workflow.actions.count', name, {
  WFCountType: 'Items', Input: source, WFInput: source,
});
export const condition = (name, input, operator, number) => action('is.workflow.actions.conditional', name, {
  GroupingIdentifier: uuid(name), WFControlFlowMode: 0,
  WFInput: { Type: 'Variable', Variable: input }, WFCondition: operator, WFNumberValue: number,
});
export const endIf = name => ({ WFWorkflowActionIdentifier: 'is.workflow.actions.conditional',
  WFWorkflowActionParameters: { GroupingIdentifier: uuid(name), WFControlFlowMode: 2 } });
export const set = (name, input, key = name) => action('is.workflow.actions.setvariable', key, { WFVariableName: name, WFInput: input });
export const number = (name, n) => action('is.workflow.actions.number', name, { WFNumberActionNumber: String(n) });
export const first = (name, input) => action('is.workflow.actions.getitemfromlist', name, { WFItemSpecifier: 'First Item', WFInput: input });
export const last = (name, input) => action('is.workflow.actions.getitemfromlist', name, { WFItemSpecifier: 'Last Item', WFInput: input });
export const alert = (name, title, body, cancel = false) => action('is.workflow.actions.alert', name, {
  WFAlertActionTitle: title, WFAlertActionMessage: body, WFAlertActionCancelButtonShown: cancel,
});

/** Apple-provided Message entity. This is a Shortcut graph, not a private API
 * invocation by the app. Each query still requires Apple's user permission. */
export function findMessages(name, { limit = 3, order = 'Latest First', predicates = [] } = {}) {
  return action('com.apple.MobileSMS.MessageEntity', name, {
    AppIntentDescriptor: { TeamIdentifier: '0000000000', BundleIdentifier: 'com.apple.MobileSMS',
      Name: 'Messages', AppIntentIdentifier: 'MessageEntity', ActionRequiresAppInstallation: true },
    WFContentItemFilter: { WFSerializationType: 'WFContentPredicateTableTemplate', Value: {
      WFActionParameterFilterPrefix: 1, WFContentPredicateBoundedDate: false,
      WFActionParameterFilterTemplates: predicates,
    } },
    WFContentItemSortProperty: 'date', WFContentItemSortOrder: order,
    WFContentItemLimitEnabled: limit !== null,
    ...(limit !== null ? { WFContentItemLimitNumber: limit } : {}),
  });
}
export const datePredicate = (operator, date) => ({ Property: 'date', Operator: operator,
  Removable: true, Values: { Unit: 4, Date: dateField(date) } });
export function makeShortcut(name, actions) {
  return { WFWorkflowName: name, WFWorkflowMinimumClientVersionString: '1106', WFWorkflowMinimumClientVersion: 1106,
    WFWorkflowClientVersion: '4042.0.2.2', WFWorkflowIcon: { WFWorkflowIconStartColor: -314141441, WFWorkflowIconGlyphNumber: 61440 },
    WFWorkflowHasOutputFallback: false, WFWorkflowOutputContentItemClasses: [], WFWorkflowInputContentItemClasses: [],
    WFWorkflowImportQuestions: [], WFWorkflowTypes: ['WFWorkflowTypeShowInSearch'], WFQuickActionSurfaces: [],
    WFWorkflowActions: actions };
}
