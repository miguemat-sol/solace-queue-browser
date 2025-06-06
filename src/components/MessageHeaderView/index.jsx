import classes from './styles.module.css';
import JsonView from 'react18-json-view';
import 'react18-json-view/src/style.css';

export default function MessageHeaderView({ message }) {
  const { meta, headers, userProperties } = message;
  return (
    <JsonView src={ {meta, headers, userProperties} } theme="atom" dark="false" />
  )
}