'use client';
import type {Measurement} from '@geld/domain';
/** Events carry only structural allowlisted properties. No optional module loads here. */
export function measure(event:Measurement['event'],properties:Measurement['properties']):void{window.dispatchEvent(new CustomEvent('geld:measurement',{detail:{event,properties}}));}
