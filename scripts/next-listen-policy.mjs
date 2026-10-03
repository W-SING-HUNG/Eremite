// Host policy applies to both development and production entry points.
export function nextArguments(command, forwardedArguments) {
  if (!['dev', 'start'].includes(command)) return [command, ...forwardedArguments];
  const validated = [];
  for (let index = 0; index < forwardedArguments.length; index += 1) {
    const argument = forwardedArguments[index];
    let hostname;
    if (argument === '-H' || argument === '--hostname') {
      hostname = forwardedArguments[++index];
    } else if (argument.startsWith('--hostname=') || argument.startsWith('-H=')) {
      hostname = argument.slice(argument.indexOf('=') + 1);
    } else if (argument.startsWith('-H') || argument === '--') {
      throw new Error('Eremite requires an explicit 127.0.0.1 hostname; ambiguous hostname arguments are unsupported.');
    } else {
      validated.push(argument);
      continue;
    }
    if (hostname !== '127.0.0.1') {
      throw new Error('Eremite dev/start must listen on 127.0.0.1. External listening addresses are unsupported.');
    }
  }
  return [command, ...validated, '--hostname', '127.0.0.1'];
}
