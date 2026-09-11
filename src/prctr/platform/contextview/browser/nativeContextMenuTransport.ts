import type { IContextMenuTransport } from '../../../base/parts/contextmenu/common/contextmenu.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export interface INativeContextMenuTransport extends IContextMenuTransport { readonly _serviceBrand: undefined; }
export const INativeContextMenuTransport = createDecorator<INativeContextMenuTransport>('nativeContextMenuTransport');
